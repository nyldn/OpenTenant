/**
 * Provider-neutral authentication boundary for the Developer MCP.
 *
 * This layer establishes identity and tenant binding only. It deliberately
 * carries no provider role, group, permission, scope, tool, or sandbox grant;
 * those policy contracts remain separate and deny by default until approved.
 */
import type { TenantId, UserId } from "./identity";

export interface VerifiedDeveloperMcpToken {
  /** Provider subject; consumed only by the binding resolver. */
  readonly externalSubject: string;
  /** Provider organization selected during OAuth. */
  readonly externalOrganizationId: string | null;
  readonly expiresAt: Date;
  /** Delegated agent authority is deferred and denied by this boundary. */
  readonly delegatedByExternalSubject: string | null;
  /** Provider impersonation is unsupported and denied. */
  readonly impersonated: boolean;
}

export type DeveloperMcpTokenVerificationResult =
  | { readonly status: "valid"; readonly token: VerifiedDeveloperMcpToken }
  | { readonly status: "invalid" };

export interface DeveloperMcpTokenVerifier {
  /**
   * Verifies signature, issuer, audience, expiry, and provider claim shape.
   * Implementations must never log, persist, return, or forward the token.
   */
  verify(token: string): Promise<DeveloperMcpTokenVerificationResult>;
}

export interface DeveloperMcpTenantBinding {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  /** Rechecked for this request; any non-active state is a denial. */
  readonly membershipStatus: "active" | "inactive";
}

export interface DeveloperMcpTenantBindingResolver {
  /** Resolves only an active membership linked to the verified provider pair. */
  resolveActiveBinding(input: {
    readonly externalSubject: string;
    readonly externalOrganizationId: string;
  }): Promise<DeveloperMcpTenantBinding | null>;
}

export interface DeveloperMcpPrincipal {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly expiresAt: Date;
}

export type DeveloperMcpAuthenticationResult =
  | { readonly status: "authenticated"; readonly principal: DeveloperMcpPrincipal }
  | { readonly status: "unauthorized" };

export interface DeveloperMcpAuthenticationInput {
  readonly authorizationHeader: string | null;
  /** Tenant already resolved from the trusted request host. */
  readonly expectedTenantId: TenantId;
}

function bearerTokenFrom(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer[ \t]+([^\s,]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function usableVerifiedToken(
  token: VerifiedDeveloperMcpToken,
  now: Date,
): token is VerifiedDeveloperMcpToken & { readonly externalOrganizationId: string } {
  const expiry = token.expiresAt.getTime();
  return token.externalSubject.length > 0
    && token.externalSubject.trim() === token.externalSubject
    && token.externalOrganizationId !== null
    && token.externalOrganizationId.length > 0
    && token.externalOrganizationId.trim() === token.externalOrganizationId
    && token.delegatedByExternalSubject === null
    && !token.impersonated
    && Number.isFinite(expiry)
    && expiry > now.getTime();
}

/**
 * Authenticates and tenant-binds one Developer MCP request without granting a
 * capability. All provider and persistence failures collapse to a generic
 * denial so external details and tokens cannot escape this boundary.
 */
export async function authenticateDeveloperMcpRequest(
  input: DeveloperMcpAuthenticationInput,
  dependencies: {
    readonly verifier: DeveloperMcpTokenVerifier;
    readonly bindings: DeveloperMcpTenantBindingResolver;
    readonly now?: () => Date;
  },
): Promise<DeveloperMcpAuthenticationResult> {
  const bearerToken = bearerTokenFrom(input.authorizationHeader);
  if (bearerToken === null) return { status: "unauthorized" };

  let verification: DeveloperMcpTokenVerificationResult;
  try {
    verification = await dependencies.verifier.verify(bearerToken);
  } catch {
    return { status: "unauthorized" };
  }

  if (verification.status !== "valid") return { status: "unauthorized" };
  const verified = verification.token;
  if (!usableVerifiedToken(verified, dependencies.now?.() ?? new Date())) {
    return { status: "unauthorized" };
  }

  let binding: DeveloperMcpTenantBinding | null;
  try {
    binding = await dependencies.bindings.resolveActiveBinding({
      externalSubject: verified.externalSubject,
      externalOrganizationId: verified.externalOrganizationId,
    });
  } catch {
    return { status: "unauthorized" };
  }

  if (
    binding === null
    || binding.membershipStatus !== "active"
    || binding.tenantId !== input.expectedTenantId
  ) {
    return { status: "unauthorized" };
  }

  return {
    status: "authenticated",
    principal: {
      userId: binding.userId,
      tenantId: binding.tenantId,
      expiresAt: new Date(verified.expiresAt),
    },
  };
}
