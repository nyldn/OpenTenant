import type { E2bOptions } from "./e2b/adapter";
import { E2bSandboxAdapter } from "./e2b/adapter";
import { MicrosandboxAdapter, type MicrosandboxOptions } from "./microsandbox/adapter";

/** Pass the validated server config here; packages never read process.env. */
export function configuredVendorSandbox(config: { readonly SANDBOX_PROVIDER?: string; readonly E2B_API_KEY?: string }, options: { readonly e2b: Omit<E2bOptions, "provider" | "apiKey">; readonly microsandbox: Omit<MicrosandboxOptions, "provider"> }) {
  if (config.SANDBOX_PROVIDER === "e2b" && config.E2B_API_KEY?.trim()) return new E2bSandboxAdapter({ ...options.e2b, provider: "e2b", apiKey: config.E2B_API_KEY });
  if (config.SANDBOX_PROVIDER === "microsandbox") return new MicrosandboxAdapter({ ...options.microsandbox, provider: "microsandbox" });
  return undefined;
}
