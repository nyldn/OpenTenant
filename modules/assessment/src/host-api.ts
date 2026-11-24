import { randomUUID } from "node:crypto";
import type { ModelStreamEvent } from "@opentenant/platform-core";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createAssessmentReadout } from "./readout";
import type { ModuleAccessResult as AssessmentAccessResult } from "@opentenant/platform-core";

export function createReadoutApi(host: ModuleHostServices) {



const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SUMMARY_CHARACTERS = 6_000;
const NO_STORE = { "Cache-Control": "no-store" };
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Accel-Buffering": "no",
};

interface ReadoutRequest {
  summary: string;
  provider?: string;
  model?: string;
}

type BoundedJsonResult =
  | { ok: true; value: unknown; sizeBytes: number }
  | { ok: false; reason: "invalid" | "too_large" };

async function readBoundedJson(req: Request): Promise<BoundedJsonResult> {
  if (!req.body) return { ok: false, reason: "invalid" };
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let sizeBytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown, sizeBytes };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function validatedReadoutRequest(
  value: unknown,
): { ok: true; value: ReadoutRequest } | { ok: false; reason: "invalid" | "too_large" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "invalid" };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.summary !== undefined && typeof candidate.summary !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (candidate.provider !== undefined && typeof candidate.provider !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (candidate.model !== undefined && typeof candidate.model !== "string") {
    return { ok: false, reason: "invalid" };
  }
  const summary = candidate.summary ?? "";
  if ([...summary].length > MAX_SUMMARY_CHARACTERS) return { ok: false, reason: "too_large" };
  if (candidate.provider !== undefined && candidate.provider.length > 40) {
    return { ok: false, reason: "invalid" };
  }
  if (candidate.model !== undefined && candidate.model.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    value: {
      summary,
      ...(candidate.provider === undefined ? {} : { provider: candidate.provider }),
      ...(candidate.model === undefined ? {} : { model: candidate.model }),
    },
  };
}

function accessDenial(access: Exclude<AssessmentAccessResult, { ok: true }>): Response {
  if (access.reason === "anonymous" || access.reason === "passcode_required") {
    return new Response("unauthorized", { status: 401, headers: NO_STORE });
  }
  if (access.reason === "forbidden") {
    return new Response("forbidden", { status: 403, headers: NO_STORE });
  }
  return new Response(null, { status: 404, headers: NO_STORE });
}

function admissionDenial(code: string): Response {
  const status = code === "control_plane_unavailable"
    ? 503
    : code === "invalid_request"
      ? 400
      : code === "size_exceeded"
        ? 413
        : code === "idempotency_conflict"
          ? 409
          : 429;
  const message = status === 503
    ? "service unavailable"
    : status === 400
      ? "invalid request"
      : status === 429
        ? "rate limited"
        : status === 413
          ? "summary too large"
          : "idempotency conflict";
  return new Response(message, { status, headers: NO_STORE });
}

async function POST(req: Request): Promise<Response> {
  if (!host.sameOrigin(req)) return new Response("forbidden", { status: 403, headers: NO_STORE });

  const cookieStore = await host.cookies();
  const grant = cookieStore.get(host.accessCookieName("assessment"))?.value;
  const access = await host.resolveModuleAccess("assessment", grant);
  if (!access.ok) return accessDenial(access);

  const parsed = await readBoundedJson(req);
  if (!parsed.ok) {
    return new Response(
      parsed.reason === "too_large" ? "request too large" : "invalid request",
      { status: parsed.reason === "too_large" ? 413 : 400, headers: NO_STORE },
    );
  }
  const validated = validatedReadoutRequest(parsed.value);
  if (!validated.ok) {
    return new Response(
      validated.reason === "too_large" ? "request too large" : "invalid request",
      { status: validated.reason === "too_large" ? 413 : 400, headers: NO_STORE },
    );
  }
  const summary = validated.value.summary;
  if (!summary) return new Response("summary required", { status: 400, headers: NO_STORE });

  let prepared;
  try {
    prepared = await createAssessmentReadout(host.modelRouter()).prepare({
      tenantId: access.tenantId,
      principal: access.principal,
      summary,
    });
  } catch {
    return new Response("model unavailable", { status: 503, headers: NO_STORE });
  }

  const admission = await host.admitPlatformRequest({
    scope: {
      tenantId: access.tenantId,
      principalId: access.principal.principalId,
      operation: "assessment.readout.generate",
    },
    idempotencyKey: req.headers.get("idempotency-key") ?? randomUUID(),
    fingerprint: prepared.fingerprint,
    sizeBytes: parsed.sizeBytes,
  }, {
    maxRequests: 20,
    windowMs: 60_000,
    maxConcurrent: 20,
    leaseMs: 30_000,
    idempotencyTtlMs: 60_000,
    maxIdempotencyEntriesPerScope: 100,
    maxSizeBytes: MAX_REQUEST_BYTES,
  });
  if (!admission.admitted) return admissionDenial(admission.code);
  if (admission.replayed) return new Response("idempotency replay", { status: 409, headers: NO_STORE });

  let streamOwnsLease = false;
  try {
    const encoder = new TextEncoder();
    const abort = new AbortController();
    let clientCancelled = false;
    let run: Promise<void> | undefined;
    let iterator: AsyncIterator<ModelStreamEvent> | undefined;
    const requestAborted = () => {
      clientCancelled = true;
      abort.abort();
    };
    if (req.signal.aborted) requestAborted();
    else req.signal.addEventListener("abort", requestAborted, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        run = (async () => {
          const remaining = Math.max(
            0,
            Math.min(PROVIDER_TIMEOUT_MS, admission.lease.expiresAtMs - Date.now()),
          );
          const timeout = setTimeout(() => abort.abort(), remaining);
          let terminalSent = false;
          const send = (event: Record<string, unknown>): boolean => {
            if (clientCancelled) return false;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              return true;
            } catch {
              clientCancelled = true;
              abort.abort();
              return false;
            }
          };
          try {
            iterator = prepared.stream(abort.signal)[Symbol.asyncIterator]();
            for (;;) {
              const next = await iterator.next();
              if (next.done) {
                if (!terminalSent) send({ error: "provider request failed" });
                break;
              }
              const event = next.value;
              if (event.type === "content") {
                if (!send({ delta: event.content })) break;
                continue;
              }
              terminalSent = true;
              if (event.type === "completed") send({ done: true });
              else if (!clientCancelled) send({ error: "provider request failed" });
              break;
            }
          } catch {
            if (!clientCancelled && !terminalSent) send({ error: "provider request failed" });
          } finally {
            clearTimeout(timeout);
            req.signal.removeEventListener("abort", requestAborted);
            try {
              await iterator?.return?.();
            } catch {
              // The public response is already bounded; cleanup cannot replace it.
            }
            if (!clientCancelled) {
              try {
                controller.close();
              } catch {
                // The client may cancel between the last event and close.
              }
            }
            await host.releasePlatformAdmission({
              scope: admission.lease.scope,
              leaseId: admission.lease.leaseId,
            });
          }
        })();
      },
      async cancel() {
        clientCancelled = true;
        abort.abort();
        await run;
      },
    });

    const response = new Response(stream, { headers: SSE_HEADERS });
    streamOwnsLease = true;
    return response;
  } finally {
    if (!streamOwnsLease) {
      await host.releasePlatformAdmission({
        scope: admission.lease.scope,
        leaseId: admission.lease.leaseId,
      });
    }
  }
}

return POST;
}
