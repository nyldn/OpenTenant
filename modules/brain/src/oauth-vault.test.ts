import { describe, expect, it } from "vitest";
import { CredentialCipher } from "@opentenant/database";
import { oauthVaultAad } from "./oauth-vault";

const TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("oauthVaultAad", () => {
  it("binds ciphertext to tenant and provider", () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const encrypted = cipher.encrypt("refresh-token", oauthVaultAad("tenant_brain", "google"));

    expect(cipher.decrypt(encrypted, oauthVaultAad("tenant_brain", "google"))).toBe("refresh-token");
    expect(() => cipher.decrypt(encrypted, oauthVaultAad("tenant_brain", "slack"))).toThrow(
      "encrypted credential record failed authentication",
    );
    expect(() => cipher.decrypt(encrypted, oauthVaultAad("tenant_other", "google"))).toThrow(
      "encrypted credential record failed authentication",
    );
  });
});
