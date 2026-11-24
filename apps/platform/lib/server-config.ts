import type { ModelRouterProviderConfig } from "./model-router-config";
import type { BrainCallOptions } from "@opentenant/brain";
import { developerMcpConfig } from "@opentenant/developer-mcp/config";
import { betterAuthConfigFromEnv } from "@opentenant/auth-better-auth/config";
/** Server configuration. Never import this module from a Client Component. */
import { validateCredentialConfig } from "@opentenant/database/credential-config";
import { clerkConfigFromEnv } from "@opentenant/auth/clerk/config";
import { normalizeHost } from "@opentenant/domains";

// The configuration module is also typechecked by Node-only migration tooling.
declare const window: unknown;

const OPTIONAL_NAMES = [
  "MODEL_OPENAI_BASE_URL", "MODEL_OPENAI_MODEL", "MODEL_OPENAI_REGION", "MODEL_OPENAI_TIMEOUT_MS", "MODEL_OPENAI_MAX_OUTPUT_TOKENS", "MODEL_OPENAI_API_VERSION", "MODEL_ANTHROPIC_BASE_URL", "MODEL_ANTHROPIC_MODEL", "MODEL_ANTHROPIC_REGION", "MODEL_ANTHROPIC_TIMEOUT_MS", "MODEL_ANTHROPIC_MAX_OUTPUT_TOKENS", "MODEL_ANTHROPIC_API_VERSION", "BRAIN_EMBEDDING_BASE_URL", "BRAIN_EMBEDDING_MODEL", "BRAIN_EMBEDDING_REGION", "BRAIN_EMBEDDING_TIMEOUT_MS", "BRAIN_EMBEDDING_API_VERSION", "BRAIN_EMBEDDING_API_KEY", "SUPPORT_AI_RETENTION_DATABASE_URLS",
  "DEVELOPER_MCP_ENABLED", "DEVELOPER_MCP_OWNER_APPROVED_ROUTE", "DEVELOPER_MCP_RESOURCE_URL", "DEVELOPER_MCP_AUTHORIZATION_SERVER", "DEVELOPER_MCP_LOCAL_IMAGE",
  "TENANT_DELETE_RETENTION_HOURS", "OPENTENANT_OPERATOR_USER_ID", "TENANT_EXPORT_DIRECTORY", "TENANT_OWNER_INVITE_DIRECTORY",
  "PROVISIONING_PROVIDER", "POSTGRES_ADMIN_DATABASE_URL", "POSTGRES_TENANT_REGION",
  "IDENTITY_SMTP_HOST", "IDENTITY_SMTP_PORT", "IDENTITY_SMTP_FROM", "IDENTITY_SMTP_USER", "IDENTITY_SMTP_PASSWORD",
  "LOCAL_USERS", "OPENTENANT_E2E",
  "AUTHZ_PROVIDER", "OPENFGA_API_URL", "OPENFGA_STORE_ID", "OPENFGA_MODEL_ID", "OPENFGA_API_TOKEN",
  "NEXT_RUNTIME", "VERCEL", "OPENTENANT_OTLP_ENDPOINT", "SENTRY_DSN", "OPENTENANT_TRUSTED_IP_HEADER",
  "IDENTITY_PROVIDER", "CONTROL_PLANE_DATABASE_URL", "TENANT_DB_ENCRYPTION_KEY",
  "TENANT_DB_ENCRYPTION_KEYS", "TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID",
  "BETTER_AUTH_SSO_TRUSTED_ORIGINS", "BETTER_AUTH_SSO_ENABLED", "BETTER_AUTH_SCIM_CONNECTION", "BETTER_AUTH_SECRET", "BETTER_AUTH_BASE_URL", "IDENTITY_PROVIDER", "CONTROL_PLANE_DATABASE_URL", "TENANT_DB_ENCRYPTION_KEY",
  "NEON_API_KEY", "NEON_ORG_ID", "WORKOS_API_KEY", "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD", "WORKOS_REDIRECT_URI", "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_JWT_ISSUER",
  "CLERK_AUTHORIZED_PARTIES", "CLERK_JWT_AUDIENCE", "MODULE_ACCESS_SECRET", "CONNECTIONS_STATE_SECRET",
  "MODULE_SIGNING_PRIVATE_KEY", "MODULE_SIGNING_PUBLIC_KEY", "MODULE_REMOTE_HOST_ALLOWLIST",
  "PLATFORM_PUBLIC_ORIGIN", "PLATFORM_ADMIN_HOST", "PLATFORM_DEV_HOST_SUFFIXES", "PLATFORM_DEFAULT_TENANT_ID",
  "LOCAL_PUBLIC_ORIGIN", "LOCAL_SESSION_TOKEN", "LOCAL_TENANT_ID", "LOCAL_USER_ID",
  "LOCAL_USER_EMAIL", "LOCAL_USER_NAME", "LOCAL_PERMISSIONS",
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SLACK_OAUTH_CLIENT_ID", "SLACK_OAUTH_CLIENT_SECRET",
  "SANDBOX_PROVIDER", "E2B_API_KEY", "USAGE_EXPORT_SINK", "USAGE_EXPORT_DIRECTORY",
  "OPENMETER_INGEST_URL", "OPENMETER_API_KEY",
] as const;
type ConfigName = typeof OPTIONAL_NAMES[number];
export type ServerConfig = Readonly<Record<ConfigName, string | undefined> & {
  NODE_ENV: NodeJS.ProcessEnv["NODE_ENV"];
  OPENTENANT_TENANT_BASE_DOMAIN: string;
}>;

function invalid(name: string): never {
  throw new Error(`Invalid or missing server configuration: ${name}`);
}

/** Pure validation for tests; production validates the complete installation. */
export function serverConfig(env: Readonly<Record<string, string | undefined>> = process.env, moduleConfigurationKeys: readonly string[] = []): ServerConfig {
  if (typeof window !== "undefined") throw new Error("Server configuration is unavailable in the browser");
  const mode = env.NODE_ENV ?? "development";
  if (!["development", "production", "test"].includes(mode)) invalid("NODE_ENV");
  const production = mode === "production";
  if (production && env.LOCAL_USERS !== undefined) invalid("LOCAL_USERS");
  if (production && env.OPENTENANT_E2E !== undefined) invalid("OPENTENANT_E2E");
  const config = Object.fromEntries([...OPTIONAL_NAMES, ...moduleConfigurationKeys].map((name) => [name, env[name] || undefined])) as Record<ConfigName, string | undefined>;
  const requireName = (name: ConfigName) => { if (!config[name]?.trim()) invalid(name); };
  const provider = config.IDENTITY_PROVIDER;
  if (provider !== undefined && !["local", "workos", "clerk", "better-auth"].includes(provider)) invalid("IDENTITY_PROVIDER");
  if (config.PROVISIONING_PROVIDER && !["neon", "postgres"].includes(config.PROVISIONING_PROVIDER)) invalid("PROVISIONING_PROVIDER");
  if (config.POSTGRES_ADMIN_DATABASE_URL) {
    try { const url = new URL(config.POSTGRES_ADMIN_DATABASE_URL); if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) invalid("POSTGRES_ADMIN_DATABASE_URL"); }
    catch { invalid("POSTGRES_ADMIN_DATABASE_URL"); }
  }
  if (production) {
    requireName("PROVISIONING_PROVIDER");
    for (const name of config.PROVISIONING_PROVIDER === "postgres" ? ["POSTGRES_ADMIN_DATABASE_URL"] as const : ["NEON_API_KEY", "NEON_ORG_ID"] as const) requireName(name);
    requireName("IDENTITY_PROVIDER");
    if (provider === "local") invalid("IDENTITY_PROVIDER");
    for (const name of ["CONTROL_PLANE_DATABASE_URL", "MODULE_ACCESS_SECRET", "CONNECTIONS_STATE_SECRET"] as const) requireName(name);
    const identityNames: ConfigName[] = provider === "workos"
      ? ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD", "WORKOS_REDIRECT_URI"]
      : provider === "better-auth"
        ? ["BETTER_AUTH_SECRET", "BETTER_AUTH_BASE_URL"]
        : ["CLERK_SECRET_KEY", "CLERK_JWT_ISSUER", "CLERK_AUTHORIZED_PARTIES", "CLERK_JWT_AUDIENCE"];
    for (const name of identityNames) requireName(name);
    if (provider === "clerk" && !config.CLERK_PUBLISHABLE_KEY && !config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) invalid("CLERK_PUBLISHABLE_KEY");
    for (const name of ["MODULE_ACCESS_SECRET", "CONNECTIONS_STATE_SECRET", ...(provider === "workos" ? ["WORKOS_COOKIE_PASSWORD" as const] : [])] as const) {
      if ((config[name]?.length ?? 0) < 32) invalid(name);
    }
  }
  if (production && provider === "clerk") {
    try { clerkConfigFromEnv({ ...config, NODE_ENV: "production" }); }
    catch { invalid("CLERK_JWT_ISSUER, CLERK_AUTHORIZED_PARTIES, CLERK_JWT_AUDIENCE"); }
  }
  if (production && provider === "workos") {
    try {
      const redirect = new URL(config.WORKOS_REDIRECT_URI!);
      if (redirect.protocol !== "https:" || redirect.username || redirect.password) invalid("WORKOS_REDIRECT_URI");
    } catch { invalid("WORKOS_REDIRECT_URI"); }
  }
  if (provider === "better-auth") betterAuthConfigFromEnv({ ...config, NODE_ENV: mode });
  const base = env.OPENTENANT_TENANT_BASE_DOMAIN || (production ? "" : "example.test");
  const host = base === "localhost" ? "localhost" : normalizeHost(base);
  if (!host || base.includes(":") || base.trim() !== base || base.endsWith(".")) invalid("OPENTENANT_TENANT_BASE_DOMAIN");
  if (config.CONTROL_PLANE_DATABASE_URL) {
    try {
      const url = new URL(config.CONTROL_PLANE_DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) invalid("CONTROL_PLANE_DATABASE_URL");
    } catch { invalid("CONTROL_PLANE_DATABASE_URL"); }
  }
  developerMcpConfig({ ...config, NODE_ENV: mode });
  validateEncryptionConfig(config, production);
  return Object.freeze(validatedAiConfiguration({ ...config, NODE_ENV: mode as NodeJS.ProcessEnv["NODE_ENV"], OPENTENANT_TENANT_BASE_DOMAIN: host }));
}

export function tenantHostname(slug: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const host = `${slug}.${serverConfig(env).OPENTENANT_TENANT_BASE_DOMAIN}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) || normalizeHost(host) !== host) invalid("tenant hostname");
  return host;
}

/** Preserve the configured local tunnel port; ordinary tenant links use HTTPS. */
export function tenantPublicOrigin(host: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (normalizeHost(host) !== host) invalid("tenant hostname");
  if (env.OPENTENANT_TENANT_BASE_DOMAIN !== "localhost" || !host.endsWith(".localhost")) return `https://${host}`;
  const origin = new URL(env.PLATFORM_PUBLIC_ORIGIN ?? "http://localhost:3000");
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname) || origin.username || origin.password) invalid("PLATFORM_PUBLIC_ORIGIN");
  return `http://${host}${origin.port ? `:${origin.port}` : ""}`;
}

function validateEncryptionConfig(config: Record<ConfigName, string | undefined>, production: boolean) {
  if (production && !config.TENANT_DB_ENCRYPTION_KEY && !config.TENANT_DB_ENCRYPTION_KEYS) invalid("TENANT_DB_ENCRYPTION_KEY");
  if (config.TENANT_DB_ENCRYPTION_KEY || config.TENANT_DB_ENCRYPTION_KEYS || config.TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID) {
    try { validateCredentialConfig(config); }
    catch { invalid(config.TENANT_DB_ENCRYPTION_KEYS ? "TENANT_DB_ENCRYPTION_KEYS / TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID" : "TENANT_DB_ENCRYPTION_KEY"); }
  }
}

/** Pure projections for Next's build configuration and edge routing. No SDK or Node imports. */
export function buildConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.NODE_ENV === "production" && env.OPENTENANT_E2E !== undefined) invalid("OPENTENANT_E2E");
  if (env.NODE_ENV === "production" && env.LOCAL_USERS !== undefined) invalid("LOCAL_USERS");
  return { NODE_ENV: env.NODE_ENV, OPENTENANT_E2E: env.OPENTENANT_E2E };
}
export function routingConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const { NODE_ENV, IDENTITY_PROVIDER, PLATFORM_ADMIN_HOST, OPENTENANT_TENANT_BASE_DOMAIN } = env;
  return { NODE_ENV, IDENTITY_PROVIDER, PLATFORM_ADMIN_HOST, OPENTENANT_TENANT_BASE_DOMAIN };
}
/** Parsers may use an explicit fixture; runtime reads always enter here. */
export function configurationEnvironment(): NodeJS.ProcessEnv {
  if (typeof window !== "undefined") throw new Error("Server configuration is unavailable in the browser");
  return Object.freeze({ ...process.env });
}

/** Optional groups are all-or-nothing; errors name keys, never values. */
function providerFields(config: Readonly<Record<string, string | undefined>>, prefix: string, version: string): { baseUrl: string; model: string; region: "us" | "eu" | "ap"; timeoutMs: number } | undefined {
  const keys = ["BASE_URL", "MODEL", "REGION", "TIMEOUT_MS", "API_VERSION"];
  if (!keys.some(key => config[`${prefix}_${key}`]) && !config[`${prefix}_API_KEY`] && !config[`${prefix}_MAX_OUTPUT_TOKENS`]) return undefined;
  for (const key of keys) if (!config[`${prefix}_${key}`]) invalid(`${prefix}_${key}`);
  try {
    const url = new URL(config[`${prefix}_BASE_URL`]!);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) invalid(`${prefix}_BASE_URL`);
  } catch { invalid(`${prefix}_BASE_URL`); }
  const model = config[`${prefix}_MODEL`]!;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) invalid(`${prefix}_MODEL`);
  const region = config[`${prefix}_REGION`];
  if (region !== "us" && region !== "eu" && region !== "ap") invalid(`${prefix}_REGION`);
  const timeoutMs = Number(config[`${prefix}_TIMEOUT_MS`]);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) invalid(`${prefix}_TIMEOUT_MS`);
  if (config[`${prefix}_API_VERSION`] !== version) invalid(`${prefix}_API_VERSION`);
  return { baseUrl: config[`${prefix}_BASE_URL`]!, model, region, timeoutMs };
}

export function modelRouterProviderConfig(config: Readonly<Record<string, string | undefined>> = serverConfig()): ModelRouterProviderConfig {
  const chat = (prefix: string, version: string) => {
    const fields = providerFields(config, prefix, version);
    if (!fields) return undefined;
    const maxOutputTokens = Number(config[`${prefix}_MAX_OUTPUT_TOKENS`]);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 65_536) invalid(`${prefix}_MAX_OUTPUT_TOKENS`);
    return { ...fields, maxOutputTokens };
  };
  const openai = chat("MODEL_OPENAI", "v1");
  const anthropic = chat("MODEL_ANTHROPIC", "2023-06-01");
  return { ...(openai ? { openai: { ...openai, apiVersion: "v1" } } : {}), ...(anthropic ? { anthropic: { ...anthropic, apiVersion: "2023-06-01" } } : {}) };
}

export function brainEmbeddingConfig(config: Readonly<Record<string, string | undefined>> = serverConfig()): BrainCallOptions["embedding"] {
  const fields = providerFields(config, "BRAIN_EMBEDDING", "v1");
  if (!fields) return undefined;
  const apiKey = config.BRAIN_EMBEDDING_API_KEY;
  if (!apiKey?.trim() || /[\r\n]/.test(apiKey)) invalid("BRAIN_EMBEDDING_API_KEY");
  // Keep the secret out of ordinary object serialization and diagnostics.
  if (!config.BRAIN_EMBEDDING_API_KEY?.trim() || /[\r\n]/.test(config.BRAIN_EMBEDDING_API_KEY)) invalid("BRAIN_EMBEDDING_API_KEY");
  return Object.defineProperty({ ...fields, apiVersion: "v1" as const, dimensions: 1536 as const, apiKey: "" }, "apiKey", { value: apiKey, enumerable: false });
}

/** Worker-only privileged connections. Operator binds each URL to one tenant. */
export function supportAiRetentionConfig(config: Readonly<Record<string, string | undefined>> = serverConfig()): ReadonlyMap<string, string> {
  if (!config.SUPPORT_AI_RETENTION_DATABASE_URLS) return new Map();
  try {
    const value: unknown = JSON.parse(config.SUPPORT_AI_RETENTION_DATABASE_URLS);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const entries = Object.entries(value);
    if (entries.length > 1000) throw new Error();
    for (const [tenant, connection] of entries) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenant) || typeof connection !== "string") throw new Error();
      const url = new URL(connection);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
    }
    return new Map(entries as [string, string][]);
  } catch { invalid("SUPPORT_AI_RETENTION_DATABASE_URLS"); }
}

function validatedAiConfiguration<T extends Readonly<Record<string, string | undefined>>>(config: T): T {
  modelRouterProviderConfig(config);
  brainEmbeddingConfig(config);
  supportAiRetentionConfig(config);
  for (const name of ["BRAIN_EMBEDDING_API_KEY", "SUPPORT_AI_RETENTION_DATABASE_URLS"] as const) Object.defineProperty(config, name, { value: config[name], enumerable: false });
  return config;
}
