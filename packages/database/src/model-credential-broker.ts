import type {
  ProviderCredentialBroker,
  TenantId,
} from "@opentenant/platform-core";
import type { CredentialCipher } from "./credential-cipher";

export interface EncryptedProviderCredentialStore {
  tenantCredential(tenantId: TenantId, provider: string): Promise<string | null>;
  installationCredential(provider: string): Promise<string | null>;
}

/**
 * Decrypts provider credentials only at the platform-owned adapter boundary.
 * Callers receive neither ciphertext nor plaintext through the model contract.
 */
export class EncryptedProviderCredentialBroker implements ProviderCredentialBroker {
  constructor(
    private readonly store: EncryptedProviderCredentialStore,
    private readonly cipher: CredentialCipher,
  ) {}

  async resolve(
    tenantId: TenantId,
    provider: string,
  ): Promise<{ origin: "tenant" | "installation"; secret: string } | null> {
    const tenantCredential = await this.store.tenantCredential(tenantId, provider);
    if (tenantCredential !== null) {
      return {
        origin: "tenant",
        secret: this.cipher.decrypt(
          tenantCredential,
          `model:${tenantId}:${provider}`,
        ),
      };
    }
    const installationCredential = await this.store.installationCredential(provider);
    if (installationCredential === null) return null;
    return {
      origin: "installation",
      secret: this.cipher.decrypt(
        installationCredential,
        `model:installation:${provider}`,
      ),
    };
  }
}
