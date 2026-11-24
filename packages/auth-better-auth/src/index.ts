export { BetterAuthIdentityGateway, IdentityAdapterError } from "./gateway";
export { betterAuthConfigFromEnv, type BetterAuthConfig } from "./config";
export { createBetterAuth } from "./lazy";
export type { BetterAuthHooks } from "./runtime";
export { handleBetterAuthRequest } from "./http";
export { migrationCatalogBefore } from "./testing";
export { betterAuthMailHooks } from "./mail";
