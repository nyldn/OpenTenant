import { parse } from "tldts";
import { normalizeHost } from "./normalize-host";

/** ASCII subdomains only. Private suffixes count as boundaries, too. */
export function customDomainHost(raw: string, reservedHosts: readonly string[]): string | null {
  if (raw.includes(":")) return null;
  const host = normalizeHost(raw);
  if (!host || host.length + "_opentenant-challenge.".length > 253 || host.split(".").some((label) => label.startsWith("xn--"))) return null;
  if (reservedHosts.some((reserved) => host === reserved || host.endsWith(`.${reserved}`))) return null;
  const parsed = parse(host, { allowPrivateDomains: true });
  if (!parsed.domain || !parsed.subdomain || parsed.isIp || (!parsed.isIcann && !parsed.isPrivate && parsed.publicSuffix !== "test")) return null;
  return host;
}
