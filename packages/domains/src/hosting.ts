import { normalizeHost } from "./normalize-host";

export type HostingDomainResult = { status: "disabled" } | {
  status: "dry-run";
  request: { method: "POST"; url: string; body: { name: string } };
};

/** Provider registration is separate from ownership verification and routing. */
export interface HostingDomainPort {
  addDomain(host: string): Promise<HostingDomainResult>;
}

/** Planning only. There is deliberately no live mode in this adapter. */
export function vercelHostingDomainPort(
  env: Readonly<Record<string, string | undefined>>,
  _transport?: (request: unknown) => Promise<unknown>,
): HostingDomainPort {
  return {
    async addDomain(host) {
      if (env.OPENTENANT_HOSTING_PROVIDER !== "vercel" || !env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) return { status: "disabled" };
      if (normalizeHost(host) !== host || !/^[a-zA-Z0-9_-]{1,100}$/.test(env.VERCEL_PROJECT_ID)) throw new Error("Invalid hosting domain configuration");
      return {
        status: "dry-run",
        request: {
          method: "POST",
          url: `https://api.vercel.com/v10/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}/domains`,
          body: { name: host },
        },
      };
    },
  };
}
