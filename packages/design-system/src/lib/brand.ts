import { browserLocation } from "@opentenant/platform-core/runtime-globals"
/**
 * Lightweight brand fixtures for the reusable module example.
 *
 * Production branding is resolved from tenant policy by platform-core. These
 * fixtures keep the standalone example renderable without naming a customer.
 */

export type BrandId = "opentenant" | "tenant"

export interface Brand {
  id: BrandId
  name: string
  productName: string
  loginTitle: string
  loginSubtitle: string
  logoSrc: string
  markSrc: string
  documentTitle: string
  showPoweredByOpenTenant: boolean
}

export const BRANDS: Record<BrandId, Brand> = {
  opentenant: {
    id: "opentenant",
    name: "OpenTenant",
    productName: "OpenTenant",
    loginTitle: "OpenTenant",
    loginSubtitle: "Sign in to continue.",
    logoSrc: "/opentenant-logo.svg",
    markSrc: "/opentenant-mark.svg",
    documentTitle: "OpenTenant",
    showPoweredByOpenTenant: false,
  },
  tenant: {
    id: "tenant",
    name: "Example Organisation",
    productName: "Example Organisation Workspace",
    loginTitle: "Example Organisation Workspace",
    loginSubtitle: "Sign in to continue.",
    logoSrc: "/example-tenant-logo.svg",
    markSrc: "/example-tenant-mark.svg",
    documentTitle: "Example Organisation Workspace",
    showPoweredByOpenTenant: true,
  },
}

const EXAMPLE_TENANT_HOSTS = ["tenant.example.test"]

/** Resolve a demo brand from a hostname, with a `?brand=` override for testing. */
export function resolveBrandId(hostname: string, search = ""): BrandId {
  const override = new URLSearchParams(search).get("brand")
  if (override === "opentenant" || override === "tenant") return override
  return EXAMPLE_TENANT_HOSTS.includes(hostname) ? "tenant" : "opentenant"
}

export function getBrandId(): BrandId {
  const location = browserLocation()
  if (!location) return "opentenant"
  return resolveBrandId(location.hostname, location.search)
}

export function getBrand(): Brand {
  return BRANDS[getBrandId()]
}
