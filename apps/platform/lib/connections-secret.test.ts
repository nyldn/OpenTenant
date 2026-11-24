import { afterEach, describe, expect, it, vi } from "vitest";
import { accessStateSecret } from "./connections-secret";
import { productionConfig } from "../test/production-config";
afterEach(() => vi.unstubAllEnvs());
describe("connection state secret separation", () => {
  it.each([undefined, ""])("fails closed in production without its dedicated secret %s", (secret) => {
    for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
    vi.stubEnv("CONNECTIONS_STATE_SECRET", secret);
    expect(() => accessStateSecret()).toThrow("CONNECTIONS_STATE_SECRET");
  });
  it("uses its own secret in production", () => {
    for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
    expect(accessStateSecret()).toBe(productionConfig.CONNECTIONS_STATE_SECRET);
  });
  it("retains development fallbacks", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CONNECTIONS_STATE_SECRET", undefined);
    vi.stubEnv("MODULE_ACCESS_SECRET", "synthetic-module-secret");
    expect(accessStateSecret()).toBe("synthetic-module-secret");
    vi.stubEnv("MODULE_ACCESS_SECRET", undefined); vi.stubEnv("WORKOS_COOKIE_PASSWORD", "synthetic-cookie-secret");
    expect(accessStateSecret()).toBe("synthetic-cookie-secret");
  });
});
