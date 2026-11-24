import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const tenants = [
  { slug: "alpha", tenantId: "tenant_e2e_alpha", displayName: "Example Alpha", colorPrimary: "#123456" },
  { slug: "beta", tenantId: "tenant_e2e_beta", displayName: "Example Beta", colorPrimary: "#abcdef" },
  { slug: "hostile", tenantId: "tenant_e2e_hostile", displayName: "Example Hostile",
    colorPrimary: "</style><script data-brand-injected>" },
];

/** Real Better Auth cookies created by the production fixture bootstrap. */
export function ownerToken(slug) {
  if (process.env.E2E_PHASE === "legacy") {
    return Buffer.from(hkdfSync("sha256", Buffer.from(process.env.LOCAL_SESSION_TOKEN, "hex"), "opentenant-e2e-owner", slug, 32)).toString("hex");
  }
  return JSON.parse(readFileSync(join(process.env.E2E_DIRECTORY, "sessions.json"), "utf8"))[slug];
}
