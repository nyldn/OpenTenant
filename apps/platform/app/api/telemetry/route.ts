import { installedModules } from "../../../opentenant-modules";
import { createLogger } from "@opentenant/observability/logger";
import { validateTelemetryEvent } from "@opentenant/observability";
import { createHash, randomUUID } from "node:crypto";
import type { TenantId } from "@opentenant/auth";
import { admitPlatformRequest, releasePlatformAdmission } from "../../../lib/admission";
import { currentSession } from "../../../lib/session";
import { currentTenant } from "../../../lib/tenant";
import { readBoundedBytes } from "../../../lib/bounded-body";

/**
 * Content-free telemetry sink (spec section 13). Validation is the security
 * boundary: only allowlisted events and properties are recorded. The sink is
 * a content-free structured logger. No client-supplied values are logged.
 */

const logger = createLogger();
const MAX_BODY_BYTES = 4096;
export async function POST(req: Request): Promise<Response> {
  const read = await readBoundedBytes(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return Response.json({ ok: false }, { status: read.reason === "too_large" ? 413 : 400 });
  }
  const sizeBytes = read.bytes.byteLength;

  let raw: string;
  let body: unknown;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const result = validateTelemetryEvent(body, Object.assign({}, ...installedModules.modules.map(definition => definition.telemetry ?? {})));
  if (!result.ok) {
    // The rejection reason names a key at most, never a value.
    return Response.json({ ok: false, reason: result.reason }, { status: 422 });
  }

  const tenant = await currentTenant();
  if (!tenant) return Response.json({ ok: false }, { status: 404 });
  const tenantId = tenant.tenantId as TenantId;
  const session = await currentSession(tenantId);
  const admission = await admitPlatformRequest({
    scope: {
      tenantId,
      // Anonymous traffic intentionally shares one server-owned bucket. Caller
      // network headers are untrusted and never participate in this scope.
      principalId: session?.userId ?? "anonymous-telemetry",
      operation: "telemetry.event.record",
    },
    idempotencyKey: req.headers.get("idempotency-key") ?? randomUUID(),
    fingerprint: createHash("sha256").update(raw).digest("hex"),
    sizeBytes,
  }, {
    maxRequests: 60, windowMs: 60_000, maxConcurrent: 60, leaseMs: 1_000,
    idempotencyTtlMs: 60_000, maxIdempotencyEntriesPerScope: 120, maxSizeBytes: MAX_BODY_BYTES,
  });
  if (!admission.admitted) {
    const status = admission.code === "control_plane_unavailable" ? 503 : admission.code === "invalid_request" ? 400 : admission.code === "size_exceeded" ? 413 : admission.code === "idempotency_conflict" ? 409 : 429;
    return Response.json({ ok: false }, { status });
  }
  if (admission.replayed) return Response.json({ ok: false }, { status: 409 });

  try {
    logger.info({ event: "telemetry.accepted", outcome: "ok" });
    return Response.json({ ok: true });
  } finally {
    await releasePlatformAdmission({ scope: admission.lease.scope, leaseId: admission.lease.leaseId });
  }
}
