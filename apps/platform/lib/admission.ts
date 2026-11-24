import { PgAdmissionStore } from "@opentenant/database";
import { processSingleton } from "@opentenant/platform-core/runtime-globals";
import { controlPlanePool } from "./control-plane";
import type {
  AdmissionDecision,
  AdmissionPolicy,
  AdmissionReleaseRequest,
  AdmissionReleaseResult,
  AdmissionRequest,
} from "@opentenant/platform-core";

const STORE_KEY = Symbol.for("opentenant.platform.admission-store");

const printable = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 128 && value === value.trim() && /^[\x20-\x7e]+$/.test(value);
const safeInteger = (value: unknown, positive = true): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

function validRequest(value: unknown): value is AdmissionRequest {
  if (!record(value) || !exact(value, ["scope", "idempotencyKey", "fingerprint", "sizeBytes"]) || !record(value.scope)
    || !exact(value.scope, ["tenantId", "principalId", "operation"])) return false;
  return printable(value.scope.tenantId) && printable(value.scope.principalId) && printable(value.scope.operation)
    && printable(value.idempotencyKey) && printable(value.fingerprint) && safeInteger(value.sizeBytes, false);
}

function validPolicy(value: unknown): value is AdmissionPolicy {
  if (!record(value) || !exact(value, [
    "maxRequests", "windowMs", "maxConcurrent", "leaseMs", "idempotencyTtlMs",
    "maxIdempotencyEntriesPerScope", "maxSizeBytes",
  ])) return false;
  return safeInteger(value.maxRequests) && safeInteger(value.windowMs) && safeInteger(value.maxConcurrent)
    && safeInteger(value.leaseMs) && safeInteger(value.idempotencyTtlMs)
    && safeInteger(value.maxIdempotencyEntriesPerScope) && safeInteger(value.maxSizeBytes, false)
    && value.idempotencyTtlMs >= value.leaseMs;
}

function admissionStore(): PgAdmissionStore {
  return processSingleton(STORE_KEY, () => new PgAdmissionStore(controlPlanePool()));
}

export async function admitPlatformRequest(
  request: AdmissionRequest,
  policy: AdmissionPolicy,
): Promise<AdmissionDecision | { admitted: false; code: "control_plane_unavailable" }> {
  try {
    if (!validRequest(request) || !validPolicy(policy)) return { admitted: false, code: "invalid_request" };
  } catch {
    return { admitted: false, code: "invalid_request" };
  }
  try {
    const decision = await admissionStore().admit(request, policy);
    // This composition root authors valid requests and literal policies. The
    // PostgreSQL adapter intentionally normalizes infrastructure exceptions to
    // invalid_request, so that code here means the control plane was unusable.
    return !decision.admitted && decision.code === "invalid_request"
      ? { admitted: false, code: "control_plane_unavailable" }
      : decision;
  } catch {
    return { admitted: false, code: "control_plane_unavailable" };
  }
}

export async function releasePlatformAdmission(
  request: AdmissionReleaseRequest,
): Promise<AdmissionReleaseResult> {
  try {
    return await admissionStore().release(request);
  } catch {
    return { status: "invalid_request" };
  }
}
