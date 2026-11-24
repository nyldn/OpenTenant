import { serverConfig } from "../../../lib/server-config";
import { safeReturnPath } from "@opentenant/auth";
import {
  localIdentityConfig,
  SESSION_COOKIE,
  usesLocalIdentity,
} from "../../../lib/identity";

export const runtime = "nodejs";

/** Establishes the single-user local session without contacting a provider. */
export async function GET(req: Request): Promise<Response> {
  if (!usesLocalIdentity() || serverConfig().NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  const requestUrl = new URL(req.url);
  const rawReturn = requestUrl.searchParams.get("return");
  const returnPath = safeReturnPath(rawReturn);
  const config = localIdentityConfig();
  const headers = new Headers();
  headers.set("Location", returnPath);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${config.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  return new Response(null, { status: 302, headers });
}
