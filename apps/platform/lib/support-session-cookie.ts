import { cookies } from "next/headers";

export const SUPPORT_SESSION_COOKIE = "opentenant_support";

export async function supportSessionToken(): Promise<string | null> {
  return (await cookies()).get(SUPPORT_SESSION_COOKIE)?.value ?? null;
}
