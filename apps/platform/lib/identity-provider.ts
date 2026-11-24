import { configurationEnvironment } from "./server-config";
import type { IdentityProvider } from "@opentenant/auth";

export type DeploymentIdentityProvider = "local" | IdentityProvider;

export function identityProviderFromEnv(
  env: NodeJS.ProcessEnv = configurationEnvironment(),
): DeploymentIdentityProvider {
  const value = env.IDENTITY_PROVIDER;
  if (value === "local" || value === "workos" || value === "clerk" || value === "better-auth") return value;
  throw new Error("Unsupported IDENTITY_PROVIDER");
}

export function usesLocalIdentity(): boolean {
  return identityProviderFromEnv() === "local";
}

export function usesClerkIdentity(): boolean {
  return identityProviderFromEnv() === "clerk";
}
