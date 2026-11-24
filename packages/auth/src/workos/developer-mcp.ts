/** WorkOS JWT adapter for the provider-neutral Developer MCP token verifier. */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type {
  DeveloperMcpTokenVerificationResult,
  DeveloperMcpTokenVerifier,
} from "../developer-mcp";

export interface WorkOSDeveloperMcpTokenVerifierConfig {
  /** Exact AuthKit issuer, including scheme and host. */
  readonly issuer: string;
  /** Exact Developer MCP Resource Indicator URL. */
  readonly audience: string;
  /** Defaults to `{issuer}/oauth2/jwks`. */
  readonly jwksUrl?: string;
}

function delegatedSubject(payload: JWTPayload): { valid: true; subject: string | null } | { valid: false } {
  const actor = payload.act;
  if (actor === undefined) return { valid: true, subject: null };
  if (typeof actor !== "object" || actor === null || Array.isArray(actor)) return { valid: false };
  const subject = (actor as Record<string, unknown>).sub;
  return typeof subject === "string" && subject.length > 0
    ? { valid: true, subject }
    : { valid: false };
}

function organizationId(payload: JWTPayload): string | null {
  const value = payload.org_id;
  return typeof value === "string" && value.length > 0 && value.trim() === value ? value : null;
}

/**
 * Validates AuthKit access tokens locally against the WorkOS JWKS. Claims are
 * reduced to the identity inputs required by the neutral tenant-binding seam;
 * OAuth scopes and provider roles do not become capability grants here.
 */
export class WorkOSDeveloperMcpTokenVerifier implements DeveloperMcpTokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private readonly config: WorkOSDeveloperMcpTokenVerifierConfig,
    getKey?: JWTVerifyGetKey,
  ) {
    const jwksUrl = config.jwksUrl ?? new URL("/oauth2/jwks", config.issuer).toString();
    this.getKey = getKey ?? createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(token: string): Promise<DeveloperMcpTokenVerificationResult> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      const orgId = organizationId(payload);
      const delegation = delegatedSubject(payload);
      if (
        typeof payload.sub !== "string"
        || payload.sub.length === 0
        || payload.sub.trim() !== payload.sub
        || typeof payload.exp !== "number"
        || payload.aud !== this.config.audience
        || orgId === null
        || !delegation.valid
      ) {
        return { status: "invalid" };
      }

      return {
        status: "valid",
        token: {
          externalSubject: payload.sub,
          externalOrganizationId: orgId,
          expiresAt: new Date(payload.exp * 1000),
          delegatedByExternalSubject: delegation.subject,
          impersonated: payload.impersonator !== undefined || payload.impersonated === true,
        },
      };
    } catch {
      return { status: "invalid" };
    }
  }
}
