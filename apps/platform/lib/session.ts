import { traceSpan } from "@opentenant/observability/tracing";
import { serverConfig } from "./server-config";
/**
 * Server-only session helper: validates the cookie against the identity
 * gateway once per request scope. Null means anonymous.
 */
import { cookies, headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import type { IdentitySession, TenantId } from "@opentenant/auth";
import { identityGateway, SESSION_COOKIE, usesClerkIdentity } from "./identity";

async function sessionCredential(): Promise<string | null> {
  if (serverConfig().IDENTITY_PROVIDER === "better-auth") return (await headers()).get("cookie");
  if (!usesClerkIdentity()) {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  }
  const clerk = await auth();
  if (!clerk.isAuthenticated) return null;
  return clerk.getToken();
}

// React supplies the cache dispatcher only during Server Component rendering;
// Route Handlers remain correct when every call executes independently.
const resolveCurrentSession = cache(async (
  expectedTenantId: TenantId | null = null,
): Promise<IdentitySession | null> => {
  const credential = await sessionCredential();
  if (!credential) return null;
  const result = await traceSpan("identity.validate", () => identityGateway().validateSession(credential, expectedTenantId));
  return result.status === "valid" ? result.session : null;
});

export function currentSession(
  expectedTenantId: TenantId | null = null,
): Promise<IdentitySession | null> {
  return resolveCurrentSession(expectedTenantId);
}
