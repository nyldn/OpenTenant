import { expect, it } from "vitest";
import { customDomainIdentityPath, platformIdentityDestination } from "./custom-domains-routing";
it("recognizes all identity-bound surfaces with path boundaries", () => {
  for (const path of ["/auth/login", "/auth/callback", "/sign-in", "/__clerk/v1", "/settings/domains", "/api/settings/connections/google/callback"]) expect(customDomainIdentityPath(path)).toBe(true);
  for (const path of ["/", "/support", "/author", "/settings-evil"]) expect(customDomainIdentityPath(path)).toBe(false);
});
it("keeps sign-in return paths on the platform, drops OAuth codes, and rejects open redirects", () => {
  expect(platformIdentityDestination("alpha.platform.test", "/auth/login?return=%2Fsupport")).toBe("https://alpha.platform.test/auth/login?return=%2Fsupport");
  expect(platformIdentityDestination("alpha.platform.test", "/auth/callback?code=secret&state=secret")).toBe("https://alpha.platform.test/auth/login");
  expect(platformIdentityDestination("alpha.platform.test", "//evil.test")).toBe("https://alpha.platform.test/auth/login");
  expect(platformIdentityDestination("alpha.platform.test", "/api/settings/connections/google/callback?code=secret")).toBe("https://alpha.platform.test/settings/connections");
});

it("drops authentication material even on encoded or provider-specific callback paths", () => {
  expect(platformIdentityDestination("alpha.platform.test", "/auth/%63allback?code=synthetic&state=synthetic")).toBe("https://alpha.platform.test/auth/login");
  expect(platformIdentityDestination("alpha.platform.test", "/__clerk/v1/oauth?code=synthetic")).toBe("https://alpha.platform.test/auth/login");
});
