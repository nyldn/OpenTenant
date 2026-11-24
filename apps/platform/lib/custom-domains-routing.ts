/** Edge-safe helpers; no database, session, or provider credentials. */
export function customDomainIdentityPath(path: string): boolean {
  return ["/auth", "/sign-in", "/__clerk", "/settings", "/api/settings"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function platformIdentityDestination(host: string, path: string): string {
  const base = `https://${host}`;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return `${base}/auth/login`;
  const url = new URL(path, base);
  if (url.pathname.includes("callback") || url.searchParams.has("code") || url.searchParams.has("state")) return `${base}${url.pathname.startsWith("/api/settings/connections/") ? "/settings/connections" : "/auth/login"}`;
  if (!customDomainIdentityPath(url.pathname)) return `${base}/auth/login`;
  return `${base}${url.pathname}${url.search}`;
}
