import { describe, expect, it } from "vitest";
import { clerkBrowserPublishableKey } from "./clerk-browser-config";

describe("Clerk browser configuration", () => {
  it("accepts the framework-neutral key emitted by Clerk CLI", () => {
    expect(clerkBrowserPublishableKey({
      CLERK_PUBLISHABLE_KEY: "unit-test-cli-publishable-value",
    })).toBe("unit-test-cli-publishable-value");
  });

  it("prefers the explicit Next.js public key", () => {
    expect(clerkBrowserPublishableKey({
      CLERK_PUBLISHABLE_KEY: "unit-test-cli-publishable-value",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "unit-test-next-publishable-value",
    })).toBe("unit-test-next-publishable-value");
  });

  it("fails with a fixed message when neither key exists", () => {
    expect(() => clerkBrowserPublishableKey({})).toThrow("Incomplete Clerk browser configuration");
  });
});
