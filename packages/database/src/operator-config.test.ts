import { expect, it } from "vitest";
import { operatorConfig } from "./operator-config";
import { CredentialCipher } from "./credential-cipher";
it("projects operator settings and preserves legacy and active rotation keyrings", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  const config = operatorConfig({ TENANT_DB_ENCRYPTION_KEY: key, TENANT_DB_ENCRYPTION_KEYS: `next:${key}`, TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "next", KEY_ROTATION_ACTOR_ID: "operator", UNRELATED_SECRET: "excluded" });
  expect(config.KEY_ROTATION_ACTOR_ID).toBe("operator");
  expect(config).not.toHaveProperty("UNRELATED_SECRET");
  expect(CredentialCipher.fromEnv(config).encrypt("test", "tenant")).toMatch(/^v1.aesgcm256.next\./);
  expect(CredentialCipher.fromEnv(operatorConfig({ TENANT_DB_ENCRYPTION_KEY: key })).encrypt("test", "tenant")).toMatch(/^v1.aesgcm256.k0\./);
});
