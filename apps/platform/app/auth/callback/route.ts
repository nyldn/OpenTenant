import { serverConfig } from "../../../lib/server-config";
import { timingSafeEqual } from "node:crypto";
import { exchangeCodeForSealedSession, safeReturnPath, workOSConfigFromEnv } from "@opentenant/auth";
import { identityProviderFromEnv, LOGIN_NONCE_COOKIE, SESSION_COOKIE } from "../../../lib/identity";

export const runtime = "nodejs";

const CLEAR_LOGIN_NONCE = `${LOGIN_NONCE_COOKIE}=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function nonceMatches(expected: string | null, received: unknown): boolean {
  if (!expected || typeof received !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function failure(body: string, status: number): Response {
  const headers = new Headers();
  headers.append("Set-Cookie", CLEAR_LOGIN_NONCE);
  return new Response(body, { status, headers });
}

/**
 * AuthKit redirect target: exchanges the code and sets the session cookie.
 * The state must carry the nonce this browser was issued at /auth/login, so
 * an attacker cannot plant their own authorization code in a victim's
 * browser and sign the victim into the attacker's account.
 */
export async function GET(req: Request): Promise<Response> {
  if (identityProviderFromEnv() !== "workos") {
    return new Response("not found", { status: 404 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return failure("missing code", 400);

  let parsed: { returnPath?: unknown; nonce?: unknown } = {};
  try {
    const state: unknown = JSON.parse(url.searchParams.get("state") ?? "");
    if (state && typeof state === "object") parsed = state as typeof parsed;
  } catch {
    /* opaque or missing state fails the nonce check below */
  }
  if (!nonceMatches(cookieValue(req, LOGIN_NONCE_COOKIE), parsed.nonce)) {
    return failure("invalid login state", 400);
  }
  const returnPath = typeof parsed.returnPath === "string" ? safeReturnPath(parsed.returnPath) : "/";

  let sealedSession: string;
  try {
    sealedSession = await exchangeCodeForSealedSession(workOSConfigFromEnv(serverConfig()), code);
  } catch {
    // Never reflect provider errors; the login page is the retry path.
    return failure("authentication failed", 401);
  }

  const headers = new Headers();
  headers.set("Location", returnPath);
  headers.append("Set-Cookie", CLEAR_LOGIN_NONCE);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sealedSession}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
  );
  return new Response(null, { status: 302, headers });
}
