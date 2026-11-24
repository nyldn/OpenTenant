import { serverConfig } from "./server-config";

/** Dedicated HMAC key for OAuth state; development retains the local fallbacks. */
export function accessStateSecret(): string {
  const config = serverConfig();
  const secret = config.CONNECTIONS_STATE_SECRET ??
    (config.NODE_ENV === "production" ? undefined :
      config.MODULE_ACCESS_SECRET ?? config.WORKOS_COOKIE_PASSWORD);
  if (!secret) throw new Error("Missing CONNECTIONS_STATE_SECRET");
  return secret;
}
