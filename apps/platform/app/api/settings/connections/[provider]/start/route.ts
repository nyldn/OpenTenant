import { serverConfig } from "../../../../../../lib/server-config";
import { enforceMutationRateLimit } from "../../../../../../lib/settings-rate-limit";
import type { NextRequest } from "next/server";
import { CredentialCipher } from "@opentenant/database";
import {
  CONNECTION_PROVIDERS,
  PROVIDER_SCOPES,
  canonicalRedirectUri,
  generatePkcePair,
  providerConfig,
  signOAuthState,
  type ConnectionProvider,
} from "../../../../../../lib/connections";
import { accessStateSecret } from "../../../../../../lib/connections-secret";
import { audit } from "../../../../../../lib/audit";
import { sameOrigin } from "../../../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../../../lib/tenant-admin";

export const runtime = "nodejs";

const STATE_TTL_MS = 10 * 60_000;

/**
 * Begins the admin click-through consent flow: 303 to the provider's
 * consent screen with least-privilege scopes, an HMAC-bound single-use
 * state, and PKCE where the provider supports it (Google; Slack OAuth v2
 * has no PKCE). The connect attempt is audited before redirecting.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { session, tenant, auditActor: actor } = gate.context;

  const { provider } = await ctx.params;
  if (!CONNECTION_PROVIDERS.includes(provider as ConnectionProvider)) {
    return new Response("unknown provider", { status: 404 });
  }
  const config = providerConfig(provider as ConnectionProvider);
  if (!config) return new Response("provider not configured for this deployment", { status: 409 });

  try {
    await audit(actor, tenant.tenantId, "connection.consent_started", provider, {
      provider,
    });
  } catch {
    return new Response("internal error", { status: 500 });
  }

  // The PKCE verifier rides inside the signed state, encrypted so the
  // user-agent only ever carries ciphertext.
  const pkce = provider === "google" ? generatePkcePair() : null;
  const state = signOAuthState(
    {
      tenantId: tenant.tenantId,
      userId: session.userId,
      provider: provider as ConnectionProvider,
      expiresAt: Date.now() + STATE_TTL_MS,
      ...(pkce
        ? {
            encryptedVerifier: CredentialCipher.fromEnv(serverConfig()).encrypt(
              pkce.verifier,
              `oauthstate:${tenant.tenantId}:${provider}`,
            ),
          }
        : {}),
    },
    accessStateSecret(),
  );

  const consent = new URL(config.authorizeUrl);
  consent.searchParams.set("client_id", config.clientId);
  consent.searchParams.set("redirect_uri", canonicalRedirectUri(req.url, provider as ConnectionProvider));
  consent.searchParams.set("state", state);
  if (provider === "google") {
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", PROVIDER_SCOPES.google.join(" "));
    // Offline access + forced consent: a refresh token must exist for
    // background sync; Google only reissues it when consent is re-prompted.
    consent.searchParams.set("access_type", "offline");
    consent.searchParams.set("prompt", "consent");
    consent.searchParams.set("code_challenge", pkce!.challenge);
    consent.searchParams.set("code_challenge_method", "S256");
  } else {
    consent.searchParams.set("scope", PROVIDER_SCOPES.slack.join(","));
  }
  return Response.redirect(consent, 303);
}
