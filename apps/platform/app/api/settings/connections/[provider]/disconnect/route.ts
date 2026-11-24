import { enforceMutationRateLimit } from "../../../../../../lib/settings-rate-limit";
import type { NextRequest } from "next/server";
import {
  CONNECTION_PROVIDERS,
  markRevokedWithAudit,
  revokeAtProvider,
  storedTokensFor,
  type ConnectionProvider,
} from "../../../../../../lib/connections";
import { sameOrigin } from "../../../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../../../lib/tenant-admin";

export const runtime = "nodejs";

/**
 * Disconnect actually contains the credential: best-effort provider-side
 * revocation first, then the vault wipe and its audit row commit together
 * (the row records the provider outcome). Ciphertext columns are nulled so
 * no later read can recover tokens even with the encryption key.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { tenant, auditActor: actor } = gate.context;

  const { provider } = await ctx.params;
  if (!CONNECTION_PROVIDERS.includes(provider as ConnectionProvider)) {
    return new Response("unknown provider", { status: 404 });
  }

  const tokens = await storedTokensFor(tenant.tenantId, provider as ConnectionProvider);
  const outcome = tokens
    ? await revokeAtProvider(provider as ConnectionProvider, tokens)
    : ("no_tokens" as const);
  await markRevokedWithAudit(tenant.tenantId, provider as ConnectionProvider, actor, outcome);
  return Response.redirect(new URL("/settings/connections", req.url), 303);
}
