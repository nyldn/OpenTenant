import { describe, expect, it } from "vitest";
import { identityProviderFromEnv } from "./identity";

describe("identityProviderFromEnv", () => {
  it.each(["local", "workos", "clerk"] as const)("selects %s explicitly", (provider) => {
    expect(identityProviderFromEnv({ IDENTITY_PROVIDER: provider, NODE_ENV: "test" })).toBe(provider);
  });

  it.each([undefined, "", "other"])("rejects unsupported value %s", (provider) => {
    expect(() => identityProviderFromEnv({ IDENTITY_PROVIDER: provider, NODE_ENV: "test" })).toThrow(
      "Unsupported IDENTITY_PROVIDER",
    );
  });
});
