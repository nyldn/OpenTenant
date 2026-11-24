import { AnthropicChatAdapter, OpenAIChatAdapter } from "./model-router-adapters";
import type { ModelRouterProviderConfig } from "./model-router-config";
import { modelRouterProviderConfig, serverConfig } from "./server-config";
import {
  CredentialCipher,
  EncryptedProviderCredentialBroker,
  PgModelRoutingStore,
  type EncryptedProviderCredentialStore,
} from "@opentenant/database";
import { ModelRouter as PlatformModelRouter } from "@opentenant/platform-core";
import type {
  ProviderCredentialBroker,
  SyntheticModelAdapter,
  TenantId,
} from "@opentenant/platform-core";
import type { Pool } from "pg";
import { controlPlanePool } from "./control-plane";

function providerCredentialStore(pool: Pool): EncryptedProviderCredentialStore {
  const credential = async (tenant: TenantId | null, provider: string): Promise<string | null> => {
    const result = await pool.query<{ encrypted_credential: Buffer }>(
      `select encrypted_credential
         from model_provider_credentials
        where tenant_id is not distinct from $1 and provider = $2`,
      [tenant, provider],
    );
    return result.rows[0]?.encrypted_credential.toString("utf8") ?? null;
  };
  return {
    tenantCredential: (tenantId, provider) => credential(tenantId, provider),
    installationCredential: (provider) => credential(null, provider),
  };
}

function localSyntheticAdapter(): SyntheticModelAdapter {
  return {
    provider: "synthetic",
    regions: ["us", "eu", "ap"],
    complete: async () => ({ output: "Synthetic module response" }),
    stream: async function* ({ signal }) {
      if (signal.aborted) return;
      yield "## Synthetic readout\n\n";
      if (signal.aborted) return;
      yield "Local model-policy routing is active. No external provider received this request.";
    },
  };
}

export function modelRouter(
  pool: Pool = controlPlanePool(),
  config: ModelRouterProviderConfig = modelRouterProviderConfig(),
): PlatformModelRouter {
  let encryptedBroker: EncryptedProviderCredentialBroker | undefined;
  const credentials: ProviderCredentialBroker = {
    resolve: async (tenantId, provider) => {
      if (provider === "synthetic" && serverConfig().NODE_ENV !== "production") {
        return { origin: "installation", secret: "synthetic-local" };
      }
      encryptedBroker ??= new EncryptedProviderCredentialBroker(
        providerCredentialStore(pool),
        CredentialCipher.fromEnv(serverConfig()),
      );
      return encryptedBroker.resolve(tenantId, provider);
    },
  };
  const adapters: SyntheticModelAdapter[] = [];
  if (config.openai) adapters.push(new OpenAIChatAdapter(config.openai));
  if (config.anthropic) adapters.push(new AnthropicChatAdapter(config.anthropic));
  if (["development", "test"].includes(serverConfig().NODE_ENV ?? "")) adapters.push(localSyntheticAdapter());
  return new PlatformModelRouter(new PgModelRoutingStore(pool), credentials, adapters);
}
