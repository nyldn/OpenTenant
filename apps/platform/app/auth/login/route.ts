import { randomBytes } from "node:crypto";
import { safeReturnPath } from "@opentenant/auth";
import { identityGateway, identityProviderFromEnv, LOGIN_NONCE_COOKIE } from "../../../lib/identity";

export const runtime = "nodejs";

const LOGIN_NONCE_TTL_SECONDS = 600;

/** Starts an AuthKit login. `?return=` is echoed back through OAuth state. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const returnPath = safeReturnPath(url.searchParams.get("return"));
  // Only the WorkOS callback exchanges a code on this origin, so only that
  // round trip needs a browser-bound nonce.
  const stateNonce = identityProviderFromEnv() === "workos"
    ? randomBytes(32).toString("base64url")
    : undefined;
  const authorizationUrl = await identityGateway().startLogin({
    tenantId: null,
    returnPath,
    requestUrl: req.url,
    ...(stateNonce ? { stateNonce } : {}),
  });
  const headers = new Headers({ Location: authorizationUrl.toString() });
  if (stateNonce) {
    headers.append(
      "Set-Cookie",
      `${LOGIN_NONCE_COOKIE}=${stateNonce}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${LOGIN_NONCE_TTL_SECONDS}`,
    );
  }
  return new Response(null, { status: 302, headers });
}
