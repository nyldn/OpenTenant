import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";

const mocks = vi.hoisted(() => ({ port: { listMembershipsForOrganization: vi.fn(), listInvitationsForOrganization: vi.fn() }, pool: vi.fn() }));
vi.mock("./control-plane", () => ({ controlPlanePool: mocks.pool }));
vi.mock("@opentenant/auth", async (original) => ({
  ...await original<typeof import("@opentenant/auth")>(),
  createWorkOSPort: () => mocks.port,
  createClerkPort: () => mocks.port,
  workOSConfigFromEnv: () => ({}),
  clerkConfigFromEnv: () => ({}),
}));
import { identityGateway } from "./identity";

beforeEach(() => {
  mocks.pool.mockReset().mockImplementation(() => { throw new Error("pool checkout while holding lock"); });
  mocks.port.listMembershipsForOrganization.mockResolvedValue([]);
  mocks.port.listInvitationsForOrganization.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("client-bound identity gateway", () => {
  it.each(["workos", "clerk"])("runs %s mapping reads on the supplied client without another pool connection", async (provider) => {
    vi.stubEnv("IDENTITY_PROVIDER", provider);
    const query = vi.fn().mockResolvedValue({ rows: [{ external_organization_id: "org_example" }] });
    const client = { query } as unknown as PoolClient;
    await expect(identityGateway(client).listTenantMembers("tenant_example" as TenantId)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("identity_org_mappings"), [provider, "tenant_example"]);
    expect(mocks.pool).not.toHaveBeenCalled();
    const secondQuery = vi.fn().mockResolvedValue({ rows: [] });
    await identityGateway({ query: secondQuery } as unknown as PoolClient).listTenantMembers("tenant_example" as TenantId);
    expect(secondQuery).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });
});
