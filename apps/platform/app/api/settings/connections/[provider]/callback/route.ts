import { serverConfig } from "../../../../../../lib/server-config";
import { enforceMutationRateLimit } from "../../../../../../lib/settings-rate-limit";
import type { NextRequest } from "next/server";
import { CredentialCipher } from "@opentenant/database";
import {
  CONNECTION_PROVIDERS,
  canonicalRedirectUri,
  consumeOAuthState,
  essentialScopesGranted,
  providerConfig,
  storeConnectionWithAudit,
  verifyOAuthState,
  type ConnectionProvider,
} from "../../../../../../lib/connections";
import { accessStateSecret } from "../../../../../../lib/connections-secret";
import { audit } from "../../../../../../lib/audit";
import { tenantAdminContext } from "../../../../../../lib/tenant-admin";

export const runtime = "nodejs";

/** Provider error codes we record verbatim; anything else becomes generic. */
const KNOWN_CONSENT_ERRORS = new Set(["access_denied", "invalid_scope", "server_error", "temporarily_unavailable"]);

function done(req: Request, outcome: "connected" | "partial" | "error"): Response {
  return Response.redirect(new URL(`/settings/connections?o=${outcome}`, req.url), 303);
}

/**
 * OAuth consent callback. Trust chain (RFC 9700 posture): the HMAC state
 * must verify, be single-use, and belong to THIS session's user and tenant;
 * the code exchange carries the PKCE verifier where supported; tokens are
 * committed to the vault in the same transaction as their audit event.
 * Plaintext token material is never logged, stored unencrypted, or returned.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { session, tenant, auditActor: actor } = gate.context;

  const { provider } = await ctx.params;
  if (!CONNECTION_PROVIDERS.includes(provider as ConnectionProvider)) {
    return new Response("unknown provider", { status: 404 });
  }
  const config = providerConfig(provider as ConnectionProvider);
  if (!config) return new Response("provider not configured", { status: 409 });

  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const claims = verifyOAuthState(state, accessStateSecret());
  if (
    !claims ||
    claims.provider !== provider ||
    claims.tenantId !== tenant.tenantId ||
    // The browser completing the flow must be the one that started it.
    claims.userId !== session.userId
  ) {
    return done(req, "error");
  }
  // Single use: a replayed state fails here even with a fresh code.
  if (!(await consumeOAuthState(state, tenant.tenantId))) return done(req, "error");

  if (!code) {
    const rawError = url.searchParams.get("error") ?? "no_code";
    const reason = KNOWN_CONSENT_ERRORS.has(rawError) ? rawError : "provider_error";
    try {
      await audit(actor, tenant.tenantId, "connection.consent_failed", provider, {
        provider,
        reason,
      });
    } catch {
      return new Response("internal error", { status: 500 });
    }
    return done(req, "error");
  }

  const exchange = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: canonicalRedirectUri(req.url, provider as ConnectionProvider),
  });
  if (claims.encryptedVerifier) {
    exchange.set(
      "code_verifier",
      CredentialCipher.fromEnv(serverConfig()).decrypt(claims.encryptedVerifier, `oauthstate:${tenant.tenantId}:${provider}`),
    );
  }
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: exchange,
  });
  if (!tokenResponse.ok) return done(req, "error");

  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let scopes: string[] = [];
  let expiresAt: Date | null = null;

  if (provider === "google") {
    const body = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    };
    accessToken = body.access_token ?? null;
    refreshToken = body.refresh_token ?? null;
    scopes = body.scope?.split(" ") ?? [];
    expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null;
    // Background sync is the whole point; without a refresh token the
    // connection dies within the hour. Fail loudly instead.
    if (accessToken && !refreshToken) {
      try {
        await audit(actor, tenant.tenantId, "connection.consent_failed", provider, {
          provider,
          reason: "no_refresh_token",
        });
      } catch {
        return new Response("internal error", { status: 500 });
      }
      return done(req, "error");
    }
  } else {
    const body = (await tokenResponse.json()) as {
      ok?: boolean;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!body.ok) return done(req, "error");
    accessToken = body.access_token ?? null;
    refreshToken = body.refresh_token ?? null;
    scopes = body.scope?.split(",") ?? [];
    expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null;
  }
  if (!accessToken) return done(req, "error");

  // A grant missing essential scopes is stored but unusable until the
  // admin re-consents; it never silently powers a partial connector.
  const complete = essentialScopesGranted(provider as ConnectionProvider, scopes);
  await storeConnectionWithAudit({
    tenantId: tenant.tenantId,
    provider: provider as ConnectionProvider,
    actor,
    accessToken,
    refreshToken,
    scopes,
    status: complete ? "active" : "reauthorization_required",
    expiresAt,
  });
  return done(req, complete ? "connected" : "partial");
}
