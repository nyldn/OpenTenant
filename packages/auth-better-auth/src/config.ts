export interface BetterAuthConfig {
  secret: string;
  baseURL: string;
  production: boolean;
  ssoEnabled?: boolean;
  ssoTrustedOrigins?: readonly string[];
  directory?: DirectoryConnection;
}

/** Pure parser, also used by the platform's typed server configuration. */
export function betterAuthConfigFromEnv(env: Readonly<Record<string, string | undefined>>): BetterAuthConfig {
  const production = env.NODE_ENV === "production";
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("Invalid server configuration: BETTER_AUTH_SECRET");
  let url: URL;
  try { url = new URL(env.BETTER_AUTH_BASE_URL ?? ""); }
  catch { throw new Error("Invalid server configuration: BETTER_AUTH_BASE_URL"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && (production || url.protocol !== "http:"
      || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid server configuration: BETTER_AUTH_BASE_URL");
  }
  let directory: DirectoryConnection | undefined;
  if (env.BETTER_AUTH_SCIM_CONNECTION) {
    try {
      const value = JSON.parse(env.BETTER_AUTH_SCIM_CONNECTION) as DirectoryConnection;
      if (!value || typeof value.id !== "string" || !value.id || typeof value.organizationId !== "string" || !value.organizationId
        || typeof value.token !== "string" || value.token.length < 32 || !value.subjects || typeof value.subjects !== "object"
        || Array.isArray(value.subjects) || Object.values(value.subjects).some((subject) => typeof subject !== "string" || !subject)) throw new Error();
      directory = value;
    } catch { throw new Error("Invalid server configuration: BETTER_AUTH_SCIM_CONNECTION"); }
  }
  if (env.BETTER_AUTH_SSO_ENABLED && !["true", "false"].includes(env.BETTER_AUTH_SSO_ENABLED)) throw new Error("Invalid server configuration: BETTER_AUTH_SSO_ENABLED");
  const ssoTrustedOrigins = (env.BETTER_AUTH_SSO_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const origin of ssoTrustedOrigins) {
    try {
      const target = new URL(origin);
      if (target.protocol !== "https:" || target.origin !== origin) throw new Error();
    } catch { throw new Error("Invalid server configuration: BETTER_AUTH_SSO_TRUSTED_ORIGINS"); }
  }
  return { secret, baseURL: url.origin, production, ssoTrustedOrigins, ssoEnabled: env.BETTER_AUTH_SSO_ENABLED === "true", ...(directory ? { directory } : {}) };
}

export interface DirectoryConnection {
  id: string;
  organizationId: string;
  token: string;
  /** Operator-reviewed immutable directory externalId -> Better Auth subject. */
  subjects: Readonly<Record<string, string>>;
}
