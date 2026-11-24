import { serverConfig } from "./server-config";
import { controlPlanePool } from "./control-plane";
/**
 * Per-tenant OAuth connections for platform-managed connectors (WP-D.1,
 * ADR-004 direct-connector path). Tokens live only in the control-plane
 * vault, encrypted with AAD oauth:${tenantId}:${provider}; plaintext never
 * leaves the request that obtained it. Admin click-through consent is the
 * only way in; there is no manual token entry.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuditActor } from "@opentenant/security";
import { CredentialCipher, PgAuditStore } from "@opentenant/database";
import { oauthVaultAad } from "@opentenant/security";

export type ConnectionProvider = "google" | "slack";

export const CONNECTION_PROVIDERS: ReadonlyArray<ConnectionProvider> = ["google", "slack"];

/**
 * Least-privilege scope sets (SOC2 posture): read-only content access plus
 * the minimum metadata each source's incremental sync requires.
 */
export const PROVIDER_SCOPES: Readonly<Record<ConnectionProvider, ReadonlyArray<string>>> = {
  google: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  slack: ["channels:history", "channels:read", "users:read"],
};

export interface ConnectionStatus {
  provider: ConnectionProvider;
  status: "not_connected" | "active" | "revoked" | "reauthorization_required";
  scopes: string[];
  expiresAt: Date | null;
  updatedAt: Date | null;
  displayName: string | null;
  healthNote: string | null;
}

export interface ProviderOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
}

/** Null when the deployment has no client credentials for the provider. */
export function providerConfig(provider: ConnectionProvider): ProviderOAuthConfig | null {
  if (provider === "google") {
    const clientId = serverConfig().GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = serverConfig().GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }
  const clientId = serverConfig().SLACK_OAUTH_CLIENT_ID;
  const clientSecret = serverConfig().SLACK_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
  };
}

export async function connectionStatuses(tenantId: string): Promise<ConnectionStatus[]> {
  const { rows } = await controlPlanePool().query<{
    provider: ConnectionProvider;
    status: "active" | "revoked" | "reauthorization_required";
    scopes: string[];
    expires_at: Date | null;
    updated_at: Date;
    display_name: string | null;
    health_note: string | null;
  }>(
    `select provider, status, scopes, expires_at, updated_at, display_name, health_note
       from oauth_token_vault where tenant_id = $1`,
    [tenantId],
  );
  return CONNECTION_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return row
      ? {
          provider,
          status: row.status,
          scopes: row.scopes,
          expiresAt: row.expires_at,
          updatedAt: row.updated_at,
          displayName: row.display_name,
          healthNote: row.health_note,
        }
      : {
          provider,
          status: "not_connected" as const,
          scopes: [],
          expiresAt: null,
          updatedAt: null,
          displayName: null,
          healthNote: null,
        };
  });
}

/**
 * Marks a state consumed exactly once; the second attempt returns false.
 * Only the hash is stored, never the state itself.
 */
export async function consumeOAuthState(state: string, tenantId: string): Promise<boolean> {
  const hash = createHash("sha256").update(state).digest("hex");
  try {
    await controlPlanePool().query(
      "insert into oauth_consumed_states (state_hash, tenant_id) values ($1, $2)",
      [hash, tenantId],
    );
    return true;
  } catch {
    return false;
  }
}

/** True when every essential scope for the provider was actually granted. */
export function essentialScopesGranted(provider: ConnectionProvider, granted: string[]): boolean {
  return PROVIDER_SCOPES[provider].every((scope) => granted.includes(scope));
}

/**
 * Audit and vault write commit or fail together (SOC2 rule: no unaudited
 * credential state). Both tables live in the control plane, so a single
 * transaction covers them; the hash chain is appended via appendWithClient.
 */
export async function storeConnectionWithAudit(input: {
  tenantId: string;
  provider: ConnectionProvider;
  actor: AuditActor;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  status: "active" | "reauthorization_required";
  expiresAt: Date | null;
}): Promise<void> {
  const cipher = CredentialCipher.fromEnv(serverConfig());
  const aad = oauthVaultAad(input.tenantId, input.provider);
  const pool = controlPlanePool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await new PgAuditStore(pool).appendWithClient(client, {
      occurredAt: new Date(),
      actor: input.actor,
      tenantId: input.tenantId,
      action: "connection.connected",
      subject: input.provider,
      detail: {
        provider: input.provider,
        scopes: input.scopes.join(" "),
        status: input.status,
        hasRefreshToken: input.refreshToken !== null,
      },
    });
    await client.query(
      `insert into oauth_token_vault
         (tenant_id, provider, encrypted_access_token, encrypted_refresh_token, scopes, status, expires_at, last_rotated_at, aad, updated_at)
       values ($1, $2, $3, $4, $5, $8, $6, now(), $7, now())
       on conflict (tenant_id, provider) do update set
         encrypted_access_token = excluded.encrypted_access_token,
         -- Never replace a good refresh token with nothing.
         encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, oauth_token_vault.encrypted_refresh_token),
         scopes = excluded.scopes,
         status = excluded.status,
         expires_at = excluded.expires_at,
         last_rotated_at = now(),
         updated_at = now()`,
      [
        input.tenantId,
        input.provider,
        cipher.encrypt(input.accessToken, aad),
        input.refreshToken === null ? null : cipher.encrypt(input.refreshToken, aad),
        input.scopes,
        input.expiresAt,
        aad,
        input.status,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Decrypted tokens for provider-side revocation; null when none stored. */
export async function storedTokensFor(
  tenantId: string,
  provider: ConnectionProvider,
): Promise<{ accessToken: string | null; refreshToken: string | null } | null> {
  const { rows } = await controlPlanePool().query<{
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
  }>(
    `select encrypted_access_token, encrypted_refresh_token
       from oauth_token_vault where tenant_id = $1 and provider = $2`,
    [tenantId, provider],
  );
  const row = rows[0];
  if (!row) return null;
  const cipher = CredentialCipher.fromEnv(serverConfig());
  const aad = oauthVaultAad(tenantId, provider);
  return {
    accessToken: row.encrypted_access_token ? cipher.decrypt(row.encrypted_access_token, aad) : null,
    refreshToken: row.encrypted_refresh_token ? cipher.decrypt(row.encrypted_refresh_token, aad) : null,
  };
}

/** Audit and revocation commit together, mirroring storeConnectionWithAudit. */
export async function markRevokedWithAudit(
  tenantId: string,
  provider: ConnectionProvider,
  actor: AuditActor,
  providerRevocation: "succeeded" | "failed" | "no_tokens",
): Promise<void> {
  const pool = controlPlanePool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await new PgAuditStore(pool).appendWithClient(client, {
      occurredAt: new Date(),
      actor,
      tenantId,
      action: "connection.disconnected",
      subject: provider,
      detail: { provider, providerRevocation },
    });
    await client.query(
      `update oauth_token_vault
          set status = 'revoked', encrypted_access_token = null, encrypted_refresh_token = null, updated_at = now()
        where tenant_id = $1 and provider = $2`,
      [tenantId, provider],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Best-effort provider-side revocation so disconnect actually contains a
 * credential, not just our copy of it. Failures are reported, not thrown;
 * the vault wipe proceeds regardless and the audit row records the outcome.
 */
export async function revokeAtProvider(
  provider: ConnectionProvider,
  tokens: { accessToken: string | null; refreshToken: string | null },
): Promise<"succeeded" | "failed" | "no_tokens"> {
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return "no_tokens";
  try {
    if (provider === "google") {
      const r = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      return r.ok ? "succeeded" : "failed";
    }
    const r = await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.accessToken ?? token}` },
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean };
    return body.ok ? "succeeded" : "failed";
  } catch {
    return "failed";
  }
}

/** PKCE (S256) for providers that support it; Slack OAuth v2 does not. */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * The canonical public origin for OAuth redirect URIs. Set
 * PLATFORM_PUBLIC_ORIGIN in production so proxy host rewriting can never
 * change what we register and exchange; request origin is the dev fallback.
 */
export function canonicalRedirectUri(reqUrl: string, provider: ConnectionProvider): string {
  const base = serverConfig().PLATFORM_PUBLIC_ORIGIN ?? new URL(reqUrl).origin;
  return new URL(`/api/settings/connections/${provider}/callback`, base).toString();
}

/**
 * CSRF/state binding for the consent round trip: HMAC over tenant, user,
 * provider, and expiry, keyed by the module-access secret. The callback
 * accepts nothing it cannot verify.
 */
export function signOAuthState(
  input: {
    tenantId: string;
    userId: string;
    provider: ConnectionProvider;
    expiresAt: number;
    /** PKCE verifier, encrypted with CredentialCipher; opaque to the browser. */
    encryptedVerifier?: string;
  },
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
  now: number = Date.now(),
): {
  tenantId: string;
  userId: string;
  provider: ConnectionProvider;
  encryptedVerifier?: string;
} | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: {
    tenantId: string;
    userId: string;
    provider: ConnectionProvider;
    expiresAt: number;
    encryptedVerifier?: string;
  };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.expiresAt !== "number" || claims.expiresAt <= now) return null;
  if (!CONNECTION_PROVIDERS.includes(claims.provider)) return null;
  return {
    tenantId: claims.tenantId,
    userId: claims.userId,
    provider: claims.provider,
    encryptedVerifier: claims.encryptedVerifier,
  };
}
