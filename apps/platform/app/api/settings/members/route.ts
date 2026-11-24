import type { PoolClient } from "pg";
import { queueMembershipSync } from "../../../../lib/authz-lifecycle";
import { settingsResult } from "../../../settings/_lib/form-response";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { identityGateway } from "../../../../lib/identity";
import { audit } from "../../../../lib/audit";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { withTenantMemberMutationLock } from "../../../../lib/member-mutation-lock";
import type { IdentitySession, MembershipId, TenantId, TenantMember } from "@opentenant/auth";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

class MemberRemovalDenied extends Error {
  constructor(readonly response: Response) {
    super("member removal denied");
  }
}

function ownerRemovalDenial(req: Request, found: TenantMember, members: TenantMember[], session: Pick<IdentitySession, "activeRole" | "isPlatformAdmin">): Response | null {
  if (found.role !== "tenant_owner") return null;
  if (!session.isPlatformAdmin && session.activeRole !== "tenant_owner") {
    return settingsResult(req, "/settings/members?error=owner", { status: "error", message: "Only a tenant owner can remove another owner." }, 403);
  }
  const hasOtherActiveOwner = members.some(member => member.membershipId !== found.membershipId && member.role === "tenant_owner" && member.status === "active");
  if (found.status === "active" && !hasOtherActiveOwner) {
    return settingsResult(req, "/settings/members?error=last_owner", { status: "error", message: "Keep at least one active tenant owner." }, 400);
  }
  return null;
}

async function mutateLockedMember(client: PoolClient, input: {
  req: Request; tenantId: string; session: Pick<IdentitySession, "activeRole" | "isPlatformAdmin">;
  membershipId: string; op: "role" | "remove"; nextRole: "tenant_admin" | "tenant_member";
}): Promise<TenantMember> {
  const { req, tenantId, session, membershipId, op, nextRole } = input;
  const gateway = identityGateway(client);
  // Ownership check and provider deletion share one cross-process
  // critical section, keyed only by the trusted internal tenant ID.
  const members = await gateway.listTenantMembers(tenantId as TenantId);
  if (members.some((member) => member.tenantId !== tenantId)) {
    throw new MemberRemovalDenied(new Response("not found", { status: 404 }));
  }
  const found = members.find((member) => member.membershipId === membershipId);
  if (!found) {
    throw new MemberRemovalDenied(new Response("not found", { status: 404 }));
  }

  if (op === "role" && (found.role === "tenant_owner" || found.kind !== "membership" || found.status !== "active")) {
    throw new MemberRemovalDenied(new Response("forbidden", { status: 403 }));
  }
  const denied = ownerRemovalDenial(req, found, members, session);
  if (denied) throw new MemberRemovalDenied(denied);

  // Persist the fence before contacting an external identity provider.
  // A database-backed provider also shares this exact transaction.
  if (found.userId) await queueMembershipSync(client, {
    tenantId: tenantId, userId: found.userId,
    role: op === "role" ? nextRole : found.role,
    active: op === "role",
  });
  if (op === "role") await gateway.setRole(found.membershipId as MembershipId, nextRole);
  else await gateway.removeMembership(found.membershipId as MembershipId);
  return found;
}

/** Member mutations: invite, change role and remove. Re-authorizes and audits every call. */
export async function POST(req: Request): Promise<Response> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { session, tenant, auditActor: actor } = gate.context;

  const form = await readBoundedForm(req);
  const op = form?.get("op");

  if (op === "invite") {
    const email = String(form?.get("email") ?? "").trim();
    const role = form?.get("role") === "tenant_admin" ? ("tenant_admin" as const) : ("tenant_member" as const);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return settingsResult(req, "/settings/members?error=email", { status: "error", message: "Enter a valid email address." }, 400);
    }
    try {
      // Commit the attempt before issuance, as with identity portal links.
      // A provider invite may succeed even if mapping or completion auditing fails.
      await audit(actor, tenant.tenantId, "member.invite_requested", tenant.tenantId, { role });
      const membershipId = await identityGateway().invite({
        email,
        tenantId: tenant.tenantId as TenantId,
        role,
        invitedBy: session.userId,
      });
      await audit(actor, tenant.tenantId, "member.invited", membershipId, {
        membershipId,
        role,
      });
    } catch {
      return settingsResult(req, "/settings/members?error=invite", { status: "error", message: "Unable to complete the invitation. Check the members list before retrying." }, 400);
    }
    return settingsResult(req, "/settings/members", { status: "success", message: "Member changes saved." });
  }

  if (op === "remove" || op === "role") {
    const nextRole = form?.get("role");
    if (op === "role" && nextRole !== "tenant_admin" && nextRole !== "tenant_member") return new Response("bad role", { status: 400 });
    if (op === "role" && !session.isPlatformAdmin && session.activeRole !== "tenant_owner") return new Response("forbidden", { status: 403 });
    const membershipId = String(form?.get("membershipId") ?? "");
    if (membershipId.length < 1 || membershipId.length > 200) {
      return settingsResult(req, "/settings/members?error=member", { status: "error", message: "Select a valid member." }, 400);
    }
    let target: TenantMember;
    try {
      target = await withTenantMemberMutationLock(
        tenant.tenantId as TenantId,
        async (client) => {
          return mutateLockedMember(client, {
            req, tenantId: tenant.tenantId, session, membershipId, op,
            nextRole: nextRole === "tenant_admin" ? "tenant_admin" : "tenant_member",
          });
        },
      );
    } catch (error) {
      if (error instanceof MemberRemovalDenied) return error.response;
      return settingsResult(req, "/settings/members?error=remove", { status: "error", message: "Could not remove the member. Check the list before retrying." }, 500);
    }
    try {
      await audit(actor, tenant.tenantId, op === "role" ? "member.role_changed" : "member.removed", target.membershipId, {
        membershipId: target.membershipId,
        role: target.role,
        status: target.status,
        ...(op === "role" ? { nextRole: String(nextRole) } : {}),
      });
    } catch {
      return new Response("internal error", { status: 500 });
    }
    return settingsResult(req, "/settings/members", { status: "success", message: "Member changes saved." });
  }

  return new Response("unknown operation", { status: 400 });
}
