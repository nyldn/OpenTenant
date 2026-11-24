import { describe, expect, it } from "vitest"
import { BRANDS, cn, resolveBrandId } from "./index"

describe("design-system public helpers", () => {
  it("resolves only the synthetic tenant hostname to the tenant brand", () => {
    expect(resolveBrandId("tenant.example.test")).toBe("tenant")
    expect(resolveBrandId("tenant.example.test.attacker.invalid")).toBe("opentenant")
    expect(resolveBrandId("unknown.example.test")).toBe("opentenant")
  })

  it("accepts only known test overrides", () => {
    expect(resolveBrandId("unknown.example.test", "?brand=tenant")).toBe("tenant")
    expect(resolveBrandId("tenant.example.test", "?brand=opentenant")).toBe("opentenant")
    expect(resolveBrandId("tenant.example.test", "?brand=untrusted")).toBe("tenant")
    expect(resolveBrandId("unknown.example.test", "?brand=untrusted")).toBe("opentenant")
  })

  it("keeps the fixture tenant synthetic", () => {
    expect(BRANDS.tenant).toEqual({
      id: "tenant",
      name: "Example Organisation",
      productName: "Example Organisation Workspace",
      loginTitle: "Example Organisation Workspace",
      loginSubtitle: "Sign in to continue.",
      logoSrc: "/example-tenant-logo.svg",
      markSrc: "/example-tenant-mark.svg",
      documentTitle: "Example Organisation Workspace",
      showPoweredByOpenTenant: true,
    })
  })

  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("base", { active: true, hidden: false }, ["px-2", "px-4"])).toBe(
      "base active px-4",
    )
  })
})
