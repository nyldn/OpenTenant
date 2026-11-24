import { describe, expect, it, vi } from "vitest";
import type { TenantId } from "@opentenant/platform-core";
import { CredentialCipher } from "./credential-cipher";
import {
  EncryptedProviderCredentialBroker,
  type EncryptedProviderCredentialStore,
} from "./model-credential-broker";

const KEY = Buffer.alloc(32, 5).toString("base64");
const tenantId = "tenant_example" as TenantId;

describe("EncryptedProviderCredentialBroker", () => {
  it("resolves and decrypts the tenant credential before installation fallback", async () => {
    const cipher = new CredentialCipher(KEY);
    const store: EncryptedProviderCredentialStore = {
      tenantCredential: vi.fn(async () =>
        cipher.encrypt("synthetic-tenant-secret", "model:tenant_example:synthetic"),
      ),
      installationCredential: vi.fn(async () =>
        cipher.encrypt("synthetic-installation-secret", "model:installation:synthetic"),
      ),
    };

    await expect(
      new EncryptedProviderCredentialBroker(store, cipher).resolve(tenantId, "synthetic"),
    ).resolves.toEqual({
      origin: "tenant",
      secret: "synthetic-tenant-secret",
    });
    expect(store.installationCredential).not.toHaveBeenCalled();
  });

  it("uses installation fallback only when no tenant credential exists", async () => {
    const cipher = new CredentialCipher(KEY);
    const store: EncryptedProviderCredentialStore = {
      tenantCredential: vi.fn(async () => null),
      installationCredential: vi.fn(async () =>
        cipher.encrypt("synthetic-installation-secret", "model:installation:synthetic"),
      ),
    };

    await expect(
      new EncryptedProviderCredentialBroker(store, cipher).resolve(tenantId, "synthetic"),
    ).resolves.toEqual({
      origin: "installation",
      secret: "synthetic-installation-secret",
    });
  });

  it("returns null when neither credential scope is configured", async () => {
    const store: EncryptedProviderCredentialStore = {
      tenantCredential: vi.fn(async () => null),
      installationCredential: vi.fn(async () => null),
    };

    await expect(
      new EncryptedProviderCredentialBroker(store, new CredentialCipher(KEY)).resolve(
        tenantId,
        "synthetic",
      ),
    ).resolves.toBeNull();
  });
});
