import { POST as betterAuthLogout } from "../../api/auth/better-auth/[...all]/route";
import { installedModules } from "../../../opentenant-modules";
import { accessCookieName } from "../../../lib/module-access";
import { auth } from "@clerk/nextjs/server";
import {
  identityGateway,
  identityProviderFromEnv,
  readSessionCookie,
  SESSION_COOKIE,
} from "../../../lib/identity";

export const runtime = "nodejs";

/** Clerk returns here after native sign-out so app-owned access cookies are cleared. */
export function GET(): Response {
  if (identityProviderFromEnv() !== "clerk") {
    return new Response("not found", { status: 404 });
  }
  const headers = new Headers({ Location: "/" });
  clearModuleAccess(headers);
  return new Response(null, { status: 302, headers });
}

export async function POST(req: Request): Promise<Response> {
  const provider = identityProviderFromEnv();
  if (provider === "better-auth") {
    const target = new URL("/api/auth/better-auth/sign-out", req.url);
    return betterAuthLogout(new Request(target, { method: "POST", headers: req.headers }));
  }
  const credential = provider === "clerk"
    ? await clerkCredential()
    : readSessionCookie(req);
  if (credential) {
    // Revocation is best-effort; the cookie clear below is what ends the
    // browser session either way.
    await identityGateway().logout(credential).catch(() => undefined);
  }
  const headers = new Headers();
  headers.set("Location", "/");
  if (provider !== "clerk") {
    const secure = provider === "local" ? "" : " Secure;";
    headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`);
  }
  // Sign-out on a shared browser must also drop module access grants.
  clearModuleAccess(headers);
  return new Response(null, { status: 302, headers });
}

async function clerkCredential(): Promise<string | null> {
  const clerk = await auth();
  if (!clerk.isAuthenticated) return null;
  return clerk.getToken();
}

function clearModuleAccess(headers: Headers): void {
  for (const definition of installedModules.modules) headers.append("Set-Cookie", `${accessCookieName(definition.manifest.key)}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
