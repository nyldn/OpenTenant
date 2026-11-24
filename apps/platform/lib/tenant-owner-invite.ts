import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IdentityGateway, IdentitySession, TenantId, UserId } from "@opentenant/auth";
import type { AuditActor } from "@opentenant/security";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import { audit } from "./audit";
import { identityGateway } from "./identity";
import { tenantWorkerConfig } from "./tenant-worker-config";
import { queueTenantJob, workerAudit } from "./tenant-worker-store";
import { validateOwnerEmail } from "./tenant-lifecycle-policy";

export const ownerTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export function ownerInviteUsable(record: { email: string; expires_at: Date; revoked_at: Date | null; consumed_at: Date | null }, email: string, now: Date): boolean {
  return record.email === email.toLowerCase() && record.expires_at > now && !record.revoked_at && !record.consumed_at;
}

/** The gateway invite grants member only. Owner elevation requires the separate single-use claim. */
export async function issueTenantOwnerInvite(tenantId: string, email: string, actor: AuditActor, options: { reissue?: boolean; gateway?: IdentityGateway } = {}): Promise<{ inviteId: string; file: string }> {
  email = validateOwnerEmail(email);
  const directory = tenantWorkerConfig().inviteDirectory;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const file = join(directory, `${id}.json`);
  const pending = `${file}.pending`;
  await writeFile(pending, JSON.stringify({ tenantId, token, email, claimPath: `/admin/tenants/${tenantId}/owner-claim` }), { mode: 0o600, flag: "wx" });
  try {
    await audit(actor, tenantId, "tenant.owner_invite_requested", id);
    const result = await withControlPlaneTransaction(async (client) => {
      const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [tenantId]);
      if (!["active", "provisioning"].includes(tenant.rows[0]?.status)) throw new Error("Tenant unavailable");
      const old = await client.query<{ id: string; membership_id: string | null; granted_at: Date | null }>(`select id,membership_id,granted_at from tenant_owner_invites where tenant_id=$1 order by issued_at desc limit 1 for update`, [tenantId]);
      if (!options.reissue && old.rows[0]) return { inviteId: old.rows[0].id, file: join(directory, `${old.rows[0].id}.json`) };
      const gateway = options.gateway ?? identityGateway(client, tenantId);
      const members = await gateway.listTenantMembers(tenantId as TenantId);
      if (members.some((member) => member.role === "tenant_owner" && member.status === "active")) throw new Error("Owner already exists; ownership transfer is unsupported");
      const previous = old.rows[0];
      if (previous?.membership_id) {
        const pendingInvite = members.find((member) => member.membershipId === previous.membership_id && member.kind === "invitation");
        if (pendingInvite) await gateway.removeMembership(pendingInvite.membershipId);
      }
      await client.query(`update tenant_owner_invites set revoked_at=now() where tenant_id=$1 and revoked_at is null`, [tenantId]);
      // The separately committed request event survives provider ambiguity.
      const membershipId = await gateway.invite({ tenantId: tenantId as TenantId, email, role: "tenant_member", invitedBy: actor.kind === "installation_owner" ? actor.userId as UserId : "system" as UserId });
      await client.query(`insert into tenant_owner_invites(id,tenant_id,email,token_hash,expires_at,membership_id) values ($1,$2,$3,$4,now()+interval '72 hours',$5)`, [id, tenantId, email, ownerTokenHash(token), membershipId]);
      await workerAudit(client, actor, tenantId, "tenant.owner_invite_issued", id, { expiresInHours: 72 });
      return { inviteId: id, file };
    });
    if (result.inviteId === id) await rename(pending, file);
    else await rm(pending, { force: true });
    return result;
  } catch (error) {
    // Keep the mode-0600 pending delivery on uncertain commits for operator recovery.
    if (!(error instanceof Error && error.name === "ControlPlaneCommitError")) await rm(pending, { force: true });
    throw error;
  }
}

/** Consume and audit first, then grant in a durable job. A worker crash cannot reuse the token. */
export async function claimTenantOwnerInvite(tenantId: string, token: string, session: IdentitySession): Promise<string> {
  if (session.activeTenantId !== tenantId || !session.activeRole) throw new Error("Tenant membership required");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid invite");
  return withControlPlaneTransaction(async (client) => {
    const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [tenantId]);
    if (tenant.rows[0]?.status !== "active") throw new Error("Invalid invite");
    const result = await client.query<{ id: string; email: string; expires_at: Date; revoked_at: Date | null; consumed_at: Date | null }>(`select * from tenant_owner_invites where tenant_id=$1 and token_hash=$2 for update`, [tenantId, ownerTokenHash(token)]);
    const invite = result.rows[0];
    if (!invite || !ownerInviteUsable(invite, session.email, new Date())) throw new Error("Invalid invite");
    await client.query(`update tenant_owner_invites set consumed_at=now(),claimed_user_id=$2 where id=$1`, [invite.id, session.userId]);
    const actor: AuditActor = { kind: "user", userId: session.userId };
    const jobId = await queueTenantJob(client, { tenantId, kind: "owner_grant", actor, input: { inviteId: invite.id } });
    // Use the real tenant actor for the claim, never imply installation authority.
    await workerAudit(client, { kind: "user", userId: session.userId }, tenantId, "tenant.owner_invite_claimed", invite.id);
    return jobId;
  });
}

/** A claimant may read only their own durable grant in the host's tenant. */
export async function ownerClaimJobStatus(tenantId: string, userId: UserId, jobId: string): Promise<string | null> {
  const result = await controlPlanePool().query<{ status: string }>(`select j.status from tenant_worker_jobs j join tenant_owner_invites i on i.id::text=j.input->>'inviteId' where j.id=$1 and j.tenant_id=$2 and j.kind='owner_grant' and i.tenant_id=$2 and i.claimed_user_id=$3`, [jobId, tenantId, userId]);
  return result.rows[0]?.status ?? null;
}
