import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/tenant", () => ({ TENANT_OVERRIDE_COOKIE: "opentenant_dev_tenant" }));
import { GET } from "./route";
const request = (host: string) => new Request(`https://${host}/dev/tenant?slug=example`, { headers: { host } });
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "preview.example.test,.other.example.test"); });
afterEach(() => vi.unstubAllEnvs());
describe("development tenant selection", () => {
  it.each(["localhost:3000", "example.localhost", "branch.preview.example.test"])("returns 404 in production on %s", async (host) => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(request(host));
    expect(response.status).toBe(404); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["localhost:3000", "example.localhost", "preview.example.test", "branch.preview.example.test", "branch.other.example.test"])("allows bounded dev host %s", async (host) => {
    expect((await GET(request(host))).status).toBe(302);
  });
  it.each(["evilpreview.example.test", "localhost.attacker.test", "localhostevil.test", "branch.other.example.test.attacker.test"])("rejects suffix confusion %s", async (host) => {
    const response = await GET(request(host));
    expect(response.status).toBe(404); expect(response.headers.get("set-cookie")).toBeNull();
  });
});
