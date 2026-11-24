export interface ClerkSdkConfig {
  secretKey: string;
  publishableKey: string;
  issuer: string;
  authorizedParties: string[];
  audience: string[];
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function commaList(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

export function clerkConfigFromEnv(
  env: NodeJS.ProcessEnv,
): ClerkSdkConfig {
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  const publishableKey = (
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY
  )?.trim();
  const issuerValue = env.CLERK_JWT_ISSUER?.trim();
  const partyValues = commaList(env.CLERK_AUTHORIZED_PARTIES);
  const audience = commaList(env.CLERK_JWT_AUDIENCE);
  if (!secretKey || !publishableKey || !issuerValue
    || partyValues.length === 0 || audience.length === 0) {
    throw new Error("Incomplete Clerk configuration");
  }

  const issuer = parseOrigin(issuerValue);
  const authorizedParties = partyValues.map(parseOrigin);
  if (issuer === null
    || authorizedParties.some((party) => party === null)
    || new Set(authorizedParties).size !== authorizedParties.length
    || new Set(audience).size !== audience.length) {
    throw new Error("Invalid Clerk configuration");
  }

  return {
    secretKey,
    publishableKey,
    issuer,
    authorizedParties: authorizedParties as string[],
    audience,
  };
}
