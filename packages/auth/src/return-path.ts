/**
 * Post-login return paths round-trip through query strings and provider
 * state, so they are attacker-controlled. Browsers treat `\` as `/` and drop
 * tabs and newlines, which turns `/\host` or `/<TAB>/host` into a
 * protocol-relative redirect. Only a same-origin path, query, and fragment
 * survive; anything else collapses to `/`.
 */
const RETURN_PATH_BASE = "https://return-path.invalid";
const MAX_RETURN_PATH_LENGTH = 2048;

export function safeReturnPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/u.test(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, RETURN_PATH_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== RETURN_PATH_BASE) return "/";
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  // Dot-segment normalisation can produce `//host` from `/.//host`.
  return normalized.startsWith("//") ? "/" : normalized;
}
