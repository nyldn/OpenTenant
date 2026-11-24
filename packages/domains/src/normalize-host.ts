/**
 * Host normalization (architecture spec section 7, step 1).
 *
 * Every inbound request's Host header passes through here before any tenant
 * lookup. The function is deliberately strict: anything that is not a clean
 * DNS hostname returns null, and callers treat null as "unknown host" and
 * fail closed with a generic response.
 */

/** RFC 1123 hostname label: alphanumeric, hyphens inside, 1-63 chars. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOST_LENGTH = 253;

export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;

  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) return null;

  // Reject IPv6 literals and anything with a path/scheme smuggled in.
  if (host.includes("/") || host.includes("\\") || host.includes("@") || host.startsWith("[")) {
    return null;
  }

  // Strip a single :port suffix; reject non-numeric or out-of-range ports so
  // proxy and application host parsing cannot disagree.
  const colon = host.indexOf(":");
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) return null;
    host = host.slice(0, colon);
  }

  // Drop one trailing dot (FQDN form); more than one is malformed.
  if (host.endsWith(".")) host = host.slice(0, -1);

  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null;

  // Reject IPv4 literals: tenants resolve by name only.
  if (/^\d+(\.\d+){3}$/.test(host)) return null;

  const labels = host.split(".");
  if (labels.length < 2) return null; // bare names never map to tenants
  for (const label of labels) {
    if (!LABEL.test(label)) return null;
  }

  return host;
}
