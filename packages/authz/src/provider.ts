// SPDX-License-Identifier: Apache-2.0
import type { AuthorizationOptions, AuthorizationPort } from "./port";
import { InProcessAuthorization } from "./adapters/in-process";

export interface AuthorizationConfig {
  AUTHZ_PROVIDER?: string | undefined;
  OPENFGA_API_URL?: string | undefined;
  OPENFGA_STORE_ID?: string | undefined;
  OPENFGA_MODEL_ID?: string | undefined;
  OPENFGA_API_TOKEN?: string | undefined;
}
/** SDK imports stay in the optional adapter composition root. Unknown config denies. */
export async function createAuthorization(config: AuthorizationConfig, options: AuthorizationOptions): Promise<AuthorizationPort> {
  if (!config.AUTHZ_PROVIDER || config.AUTHZ_PROVIDER === "in-process") return new InProcessAuthorization(options);
  if (config.AUTHZ_PROVIDER !== "openfga" || !config.OPENFGA_API_URL || !config.OPENFGA_STORE_ID || !config.OPENFGA_MODEL_ID) {
    throw new Error("Invalid authorization configuration");
  }
  const { OpenFgaAuthorization } = await import("./adapters/openfga");
  return new OpenFgaAuthorization({
    apiUrl: config.OPENFGA_API_URL, storeId: config.OPENFGA_STORE_ID, authorizationModelId: config.OPENFGA_MODEL_ID,
    ...(config.OPENFGA_API_TOKEN ? { apiToken: config.OPENFGA_API_TOKEN } : {}),
  }, options);
}
