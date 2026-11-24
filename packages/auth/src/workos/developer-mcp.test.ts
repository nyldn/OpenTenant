import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  WorkOSDeveloperMcpTokenVerifier,
  type WorkOSDeveloperMcpTokenVerifierConfig,
} from "./developer-mcp";

const config: WorkOSDeveloperMcpTokenVerifierConfig = {
  issuer: "https://auth.example.test",
  audience: "https://platform.example.test/api/mcp/developer",
};

let sign: (
  claims?: JWTPayload,
  options?: { issuer?: string; audience?: string | readonly string[]; expiresIn?: string; subject?: string },
) => Promise<string>;
let verifier: WorkOSDeveloperMcpTokenVerifier;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "synthetic-key";
  verifier = new WorkOSDeveloperMcpTokenVerifier(
    config,
    createLocalJWKSet({ keys: [publicJwk] }),
  );
  sign = async (claims = {}, options = {}) => {
    const audience = options.audience ?? config.audience;
    return new SignJWT({
      org_id: "workos_org_a",
      scope: "module.dev.connect profile",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic-key" })
      .setIssuer(options.issuer ?? config.issuer)
      .setAudience(typeof audience === "string" ? audience : [...audience])
      .setSubject(options.subject ?? "workos_user_a")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
  };
});

describe("WorkOS Developer MCP token verifier", () => {
  it("verifies signature, issuer, audience, expiry, subject, and organization", async () => {
    const result = await verifier.verify(await sign());

    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("expected a valid token");
    expect(result.token).toMatchObject({
      externalSubject: "workos_user_a",
      externalOrganizationId: "workos_org_a",
      delegatedByExternalSubject: null,
      impersonated: false,
    });
    expect(result.token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.token).not.toHaveProperty("scope");
  });

  it.each([
    ["wrong audience", {}, { audience: "https://platform.example.test/api/mcp/brain" }],
    ["multiple audiences", {}, { audience: [config.audience, "https://platform.example.test/api/mcp/brain"] }],
    ["wrong issuer", {}, { issuer: "https://other-auth.example.test" }],
    ["expired", {}, { expiresIn: "-1s" }],
    ["missing organization", { org_id: undefined }, {}],
    ["empty organization", { org_id: "" }, {}],
    ["whitespace organization", { org_id: "   " }, {}],
    ["whitespace subject", {}, { subject: "   " }],
  ] as const)("rejects %s tokens", async (_name, claims, options) => {
    await expect(verifier.verify(await sign(claims, options))).resolves.toEqual({ status: "invalid" });
  });

  it("rejects a token without a subject", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.alg = "RS256";
    publicJwk.kid = "subjectless-key";
    const subjectlessVerifier = new WorkOSDeveloperMcpTokenVerifier(
      config,
      createLocalJWKSet({ keys: [publicJwk] }),
    );
    const token = await new SignJWT({ org_id: "workos_org_a" })
      .setProtectedHeader({ alg: "RS256", kid: "subjectless-key" })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(subjectlessVerifier.verify(token)).resolves.toEqual({ status: "invalid" });
  });

  it("marks delegated and impersonated identities for denial by the neutral boundary", async () => {
    const delegated = await verifier.verify(await sign({ act: { sub: "workos_user_delegate" } }));
    const impersonated = await verifier.verify(await sign({ impersonator: { email: "admin@example.test" } }));

    expect(delegated).toMatchObject({
      status: "valid",
      token: { delegatedByExternalSubject: "workos_user_delegate", impersonated: false },
    });
    expect(impersonated).toMatchObject({
      status: "valid",
      token: { delegatedByExternalSubject: null, impersonated: true },
    });
  });

  it("normalizes malformed JWTs and unsupported delegation claims", async () => {
    await expect(verifier.verify("not-a-jwt")).resolves.toEqual({ status: "invalid" });
    await expect(verifier.verify(await sign({ act: "unexpected" }))).resolves.toEqual({ status: "invalid" });
  });
});
