/**
 * Request bodies are read before most routes can authenticate, and a
 * self-hosted Node server applies no default size limit to route handlers.
 * These readers stop at a byte ceiling instead of buffering whatever the
 * client sends.
 */
export const DEFAULT_FORM_MAX_BYTES = 64 * 1024;

export type BoundedBytesResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "invalid" | "too_large" };

export async function readBoundedBytes(req: Request, maxBytes: number): Promise<BoundedBytesResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return { ok: false, reason: "invalid" };
    if (length > maxBytes) return { ok: false, reason: "too_large" };
  }
  if (!req.body) return { ok: true, bytes: new Uint8Array(new ArrayBuffer(0)) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "invalid" };
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Parses a bounded form body; null for oversized, malformed, or non-form bodies. */
export async function readBoundedForm(
  req: Request,
  maxBytes: number = DEFAULT_FORM_MAX_BYTES,
): Promise<FormData | null> {
  const body = await readBoundedBytes(req, maxBytes);
  if (!body.ok) return null;
  const contentType = req.headers.get("content-type");
  if (!contentType) return null;
  return new Response(body.bytes, { headers: { "content-type": contentType } })
    .formData()
    .catch(() => null);
}
