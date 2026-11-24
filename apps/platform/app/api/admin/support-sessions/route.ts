import { serverConfig } from "../../../../lib/server-config";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { cookies } from "next/headers";
import { PgAuditStore } from "@opentenant/database";
import { installationOwnerContext } from "../../../../lib/installation-owner";
import { sameOrigin } from "../../../../lib/settings-guard";
import { SUPPORT_SESSION_COOKIE } from "../../../../lib/support-session-cookie";
import { supportSessionDatabase, supportSessionStore } from "../../../../lib/support-session-store";
import { currentTenant } from "../../../../lib/tenant";
import { withControlPlaneTransaction } from "../../../../lib/control-plane";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";
const SUPPORT_SESSION_UNAVAILABLE = Symbol("support_session_unavailable");

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const owner = await installationOwnerContext("owner.support.enter");
  if (!owner.ok) return new Response("forbidden", { status: 403 });
  const tenant = await currentTenant();
  if (!tenant) return new Response("tenant not found", { status: 404 });
  // module-audit-exclude: installation operator support budget exists without any installed module.
  const limited = await enforceRateLimit(req, { tenantId: tenant.tenantId, userId: owner.context.authority.userId, routeClass: "support" }); if (limited) return limited;
  const form = await readBoundedForm(req);
  const reason = String(form?.get("reason") ?? "").trim();
  const referenceValue = String(form?.get("reference") ?? "").trim();
  if (reason.length < 8 || reason.length > 500 || referenceValue.length > 120) {
    return new Response("invalid support context", { status: 400 });
  }
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const db = supportSessionDatabase();
  let created: Awaited<ReturnType<ReturnType<typeof supportSessionStore>["createWithClient"]>>;
  try {
    created = await withControlPlaneTransaction(async (client) => {
      const result = await supportSessionStore().createWithClient(client, {
        tenantId: tenant.tenantId,
        operatorUserId: owner.context.authority.userId,
        reason,
        reference: referenceValue || null,
        allowedActionClasses: ["routine_configuration"],
        expiresAt,
      });
      if (!result) throw SUPPORT_SESSION_UNAVAILABLE;
      await new PgAuditStore(db).appendWithClient(client, {
        occurredAt: new Date(),
        actor: { kind: "installation_owner", userId: owner.context.authority.userId },
        tenantId: tenant.tenantId,
        action: "support.session_started",
        subject: result.session.sessionId,
        detail: { reason, reference: result.session.reference, expiresAt: expiresAt.toISOString() },
      });
      return result;
    }, db);
  } catch (error) {
    if (error === SUPPORT_SESSION_UNAVAILABLE) {
      return new Response("managed support unavailable", { status: 403 });
    }
    return new Response("internal error", { status: 500 });
  }
  (await cookies()).set(SUPPORT_SESSION_COOKIE, created.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: serverConfig().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return Response.redirect(new URL("/settings", req.url), 303);
}
