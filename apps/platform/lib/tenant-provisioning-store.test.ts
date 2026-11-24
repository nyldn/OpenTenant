import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), append: vi.fn(), read: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock("./control-plane", async (original) => {
  const actual = await original<typeof import("./control-plane")>();
  const pool = { query: h.read, connect: h.connect };
  return { ...actual, controlPlanePool: () => pool, withControlPlaneTransaction: (work: (client: unknown) => unknown) => actual.withControlPlaneTransaction(work as never, pool as never) };
});
vi.mock("@opentenant/database", () => ({ PgAuditStore: class { appendWithClient = h.append; } }));
import { activateProvisionedTenant, TenantActivationOutcomeUnknownError } from "./tenant-provisioning-store";
const input = { tenantId: "tenant_example", slug: "example", actor: { kind: "installation_owner" as const, userId: "operator_example" } };
describe("provisioning activation commit evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.connect.mockResolvedValue({ query: h.query, release: h.release });
    h.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("update tenants") ? [{ tenant_id: input.tenantId }] : [] }));
    h.append.mockResolvedValue({ sequence: 1, hash: "synthetic" });
    h.read.mockResolvedValue({ rows: [{ status: "active", provisioned: true }] });
  });
  it("commits activation and its audit on the same client", async () => {
    await activateProvisionedTenant(input);
    expect(h.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s/)[0])).toEqual(["begin", "update", "commit"]);
    expect(h.append).toHaveBeenCalledWith(expect.objectContaining({ query: h.query }), expect.objectContaining({ action: "tenant.provisioned" }));
  });
  it("rolls back activation when audit append fails", async () => {
    h.append.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(activateProvisionedTenant(input)).rejects.toThrow("audit failure");
    expect(h.query).toHaveBeenCalledWith("rollback");
    expect(h.query).not.toHaveBeenCalledWith("commit");
  });
  it("does not activate a tenant that left provisioning", async () => {
    h.query.mockResolvedValue({ rows: [] });
    await expect(activateProvisionedTenant(input)).rejects.toThrow("no longer provisioning");
    expect(h.append).not.toHaveBeenCalled();
  });
  it("reconciles a lost commit acknowledgement from exact audit evidence", async () => {
    h.query.mockImplementation(async (sql: string) => { if (sql === "commit") throw new Error("lost ack"); return { rows: sql.includes("update tenants") ? [{ tenant_id: input.tenantId }] : [] }; });
    await expect(activateProvisionedTenant(input)).resolves.toBeUndefined();
    expect(h.read).toHaveBeenCalledWith(expect.stringContaining("e.hash = $4"), [input.tenantId, input.slug, 1, "synthetic"]);
  });
  it("reports ambiguous activation when readback is unavailable", async () => {
    h.query.mockImplementation(async (sql: string) => { if (sql === "commit") throw new Error("lost ack"); return { rows: sql.includes("update tenants") ? [{ tenant_id: input.tenantId }] : [] }; });
    h.read.mockRejectedValueOnce(new Error("offline"));
    await expect(activateProvisionedTenant(input)).rejects.toBeInstanceOf(TenantActivationOutcomeUnknownError);
  });
});
