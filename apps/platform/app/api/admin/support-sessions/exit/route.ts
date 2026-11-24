import { enforceRateLimit } from "../../../../../lib/rate-limit";
import { cookies } from "next/headers";
import { PgAuditStore } from "@opentenant/database";
import { currentSession } from "../../../../../lib/session";
import { sameOrigin } from "../../../../../lib/settings-guard";
import { SUPPORT_SESSION_COOKIE, supportSessionToken } from "../../../../../lib/support-session-cookie";
import { supportSessionDatabase, supportSessionStore } from "../../../../../lib/support-session-store";
import { withControlPlaneTransaction } from "../../../../../lib/control-plane";

export const runtime = "nodejs";
const SUPPORT_SESSION_FORBIDDEN = Symbol("support_session_forbidden");

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const operator = await currentSession();
  const token = await supportSessionToken();
  if (!operator || !token) return new Response("forbidden", { status: 403 });
  // module-audit-exclude: installation operator support budget exists without any installed module.
  const limited = await enforceRateLimit(req, { tenantId: "installation", userId: operator.userId, routeClass: "support" }); if (limited) return limited;
  const db = supportSessionDatabase();
  try {
    await withControlPlaneTransaction(async (client) => {
      const result = await supportSessionStore().revokeWithClient(client, token, operator.userId);
      if (!result) throw SUPPORT_SESSION_FORBIDDEN;
      await new PgAuditStore(db).appendWithClient(client, {
        occurredAt: new Date(),
        actor: { kind: "installation_owner", userId: operator.userId },
        tenantId: result.tenantId,
        action: "support.session_ended",
        subject: result.sessionId,
        detail: { reason: result.reason, reference: result.reference },
      });
      return result;
    }, db);
  } catch (error) {
    if (error === SUPPORT_SESSION_FORBIDDEN) return new Response("forbidden", { status: 403 });
    return new Response("internal error", { status: 500 });
  }
  (await cookies()).delete(SUPPORT_SESSION_COOKIE);
  return Response.redirect(new URL("/", req.url), 303);
}
