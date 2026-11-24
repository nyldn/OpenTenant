import { installedModules } from "../../../../opentenant-modules";
import { nativeModuleEnabled } from "../../../../lib/module-registry";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import type { TenantId } from "@opentenant/auth";
import { accessCookieName, passcodeAdmissionFingerprint, verifyModulePasscode } from "../../../../lib/module-access";
import { randomUUID } from "node:crypto";
import { admitPlatformRequest, releasePlatformAdmission } from "../../../../lib/admission";
import { currentSession } from "../../../../lib/session";
import { currentTenant } from "../../../../lib/tenant";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

/**
 * Server-side passcode verification for the installed module. Admission is
 * scoped by trusted tenant and principal to slow guessing; the passcode is compared against an scrypt hash
 * and never logged.
 */
export async function POST(req: Request, context: { params: Promise<{ module: string }> }): Promise<Response> {
  const moduleKey = (await context.params).module;
  const definition = installedModules.get(moduleKey);
  if (!definition?.permissions.passcode?.length) return new Response(null, { status: 404 });
  const form = await readBoundedForm(req);
  const passcode = form?.get("passcode");
  if (typeof passcode !== "string" || passcode.length === 0 || passcode.length > 128) {
    return Response.redirect(new URL(`/access/${moduleKey}?error=1`, req.url), 303);
  }

  const tenant = await currentTenant();
  if (!tenant) return new Response(null, { status: 404 });
  const tenantId = tenant.tenantId as TenantId;
  if (!await nativeModuleEnabled(tenantId, moduleKey)) return new Response(null, { status: 404 });
  const session = await currentSession(tenantId);
  const limited = await enforceRateLimit(req, { tenantId, userId: session?.userId ?? "anonymous", routeClass: "passcode" }); if (limited) return limited;
  // Anonymous attempts deliberately share one server-owned tenant/module
  // bucket. Caller-supplied network identifiers are not trusted as identity.
  const principalId = session?.userId ?? "anonymous-passcode-attempt";
  const admission = await admitPlatformRequest({
    scope: { tenantId, principalId, operation: `${moduleKey}.module-access.verify` },
    idempotencyKey: req.headers.get("idempotency-key") ?? randomUUID(),
    fingerprint: passcodeAdmissionFingerprint(tenantId, moduleKey, passcode),
    sizeBytes: new TextEncoder().encode(passcode).byteLength,
  }, {
    maxRequests: 10, windowMs: 60_000, maxConcurrent: 10, leaseMs: 1_000,
    idempotencyTtlMs: 60_000, maxIdempotencyEntriesPerScope: 40, maxSizeBytes: 128,
  });
  if (!admission.admitted) {
    if (admission.code === "control_plane_unavailable") return new Response("service unavailable", { status: 503 });
    if (admission.code === "invalid_request") return new Response("invalid request", { status: 400 });
    if (admission.code === "idempotency_conflict") return new Response("idempotency conflict", { status: 409 });
    if (admission.code === "size_exceeded") return new Response("request too large", { status: 413 });
    return new Response("rate limited", { status: 429 });
  }
  if (admission.replayed) return new Response("idempotency replay", { status: 409 });
  try {
    const result = await verifyModulePasscode(tenantId, moduleKey, passcode);
    if (!result.granted) {
      return Response.redirect(new URL(`/access/${moduleKey}?error=1`, req.url), 303);
    }

    const headers = new Headers();
    headers.set("Location", new URL(definition.routes[0]!.path, req.url).toString());
    headers.append(
      "Set-Cookie",
      `${accessCookieName(moduleKey)}=${result.cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    );
    return new Response(null, { status: 303, headers });
  } finally {
    await releasePlatformAdmission({ scope: admission.lease.scope, leaseId: admission.lease.leaseId });
  }
}
