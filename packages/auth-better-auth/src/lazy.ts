import type { Pool } from "pg";
import type { BetterAuthConfig } from "./config";
import type { BetterAuthHooks, BetterAuthRuntime } from "./runtime";

/** Keep the optional vendor SDK out of other providers' startup paths. */
export function createBetterAuth(pool: Pool, config: BetterAuthConfig, hooks?: BetterAuthHooks): BetterAuthRuntime {
  let instance: Promise<BetterAuthRuntime> | undefined;
  const load = () => instance ??= import("./runtime").then((sdk) => sdk.createBetterAuth(pool, config, hooks));
  return {
    handler: async (request) => (await load()).handler(request),
    api: new Proxy({} as BetterAuthRuntime["api"], {
      get: (_target, method: keyof BetterAuthRuntime["api"]) => async (...args: unknown[]) => {
        const auth = await load();
        return Reflect.apply(auth.api[method], auth.api, args);
      },
    }),
  };
}
