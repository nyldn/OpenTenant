import { tenantLifecycleForHost } from "./tenant";
import { suspendedTenantResponse } from "./tenant-lifecycle-policy";
/**
 * Shared helpers for tenant-admin mutation routes: CSRF (same-origin) guard
 * and the correct audit actor for the session.
 */
import type { IdentitySession } from "@opentenant/auth";
import type { AuditActor } from "@opentenant/security";

/**
 * Reject cross-origin form posts. Cookie-authenticated mutations are
 * forgeable from another origin without this check. A missing Origin (e.g.
 * same-origin GET-less navigations) is allowed; a present, mismatched Origin
 * is rejected.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    // Full-origin comparison: an http:// origin must not pass for an
    // https:// endpoint even on the same host.
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

/** Audit actor reflecting privilege: platform admins are recorded as such. */
export function auditActor(session: IdentitySession, managedSupport = false): AuditActor {
  if (managedSupport) return { kind: "installation_owner", userId: session.userId };
  return session.isPlatformAdmin
    ? { kind: "platform_admin", userId: session.userId }
    : { kind: "user", userId: session.userId };
}

/** Host lifecycle checks disclose no tenant identity and fail closed on store errors. */
export async function tenantApiLifecycleResponse(): Promise<Response | null> {
  try {
    const lifecycle = await tenantLifecycleForHost();
    return lifecycle?.status === "suspended" ? suspendedTenantResponse() : null;
  } catch {
    return new Response("service unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function unavailableTenantContext(): Promise<{ ok: false; reason: "no_tenant"; response?: Response }> {
  const response = await tenantApiLifecycleResponse();
  return response ? { ok: false, reason: "no_tenant", response } : { ok: false, reason: "no_tenant" };
}
