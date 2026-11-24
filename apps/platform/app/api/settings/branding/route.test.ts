import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), query: vi.fn(), audit: vi.fn(), write: vi.fn(), owns: vi.fn(), transaction: vi.fn() }));
vi.mock("../../../../lib/tenant-admin", () => ({ tenantAdminContext: mocks.gate }));
vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: async () => null }));
vi.mock("../../../../lib/settings-guard", () => ({ sameOrigin: () => true }));
vi.mock("../../../../lib/control-plane", () => ({ controlPlanePool: () => ({}), withControlPlaneTransaction: mocks.transaction }));
vi.mock("../../../../lib/tenant-settings-store", () => ({ writeBrandOverrides: mocks.write }));
vi.mock("../../../../lib/tenant-branding-assets", () => ({ tenantOwnsBrandingAsset: mocks.owns }));
vi.mock("@opentenant/database", () => ({ PgAuditStore: class { appendWithClient = mocks.audit; } }));
import { POST } from "./route";
function request(data: Record<string, string>) { return new Request("https://alpha.example.test/api/settings/branding", { method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams(data) }); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ ok: true, context: { tenant: { tenantId: "ten_alpha" }, auditActor: { kind: "user", userId: "usr_alpha" } } });
  mocks.query.mockResolvedValue({ rows: [{ overrides: { displayName: "Alpha" }, locked_keys: [] }] });
  mocks.transaction.mockImplementation(work => work({ query: mocks.query }));
  mocks.owns.mockResolvedValue(true);
});
it("announces unchanged without writing or auditing", async () => {
  const result = await POST(request({ displayName: "Alpha" }));
  expect(await result.json()).toEqual({ status: "success", message: "Branding unchanged." });
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("waits for transaction commit before returning saved", async () => {
  let commit!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const committed = new Promise<void>(resolve => { commit = resolve; });
  mocks.transaction.mockImplementation(async work => { const result = await work({ query: mocks.query }); entered(); await committed; return result; });
  let returned = false;
  const saving = POST(request({ displayName: "Revised" })).then(result => { returned = true; return result; });
  await ready; expect(returned).toBe(false); expect(mocks.audit).toHaveBeenCalled();
  commit(); expect(await (await saving).json()).toEqual({ status: "success", message: "Branding saved." });
});
it("does not announce success when commit fails", async () => {
  mocks.transaction.mockImplementation(async work => { await work({ query: mocks.query }); throw new Error("private connection diagnostic"); });
  const result = await POST(request({ displayName: "Revised" }));
  expect(result.status).toBe(500); expect(await result.json()).toEqual({ status: "error", message: "Could not save branding. Try again." });
});
it("rejects another tenant asset inside the write transaction", async () => {
  mocks.owns.mockResolvedValue(false);
  const result = await POST(request({ logoUrl: "/api/settings/branding/assets/asset_beta" }));
  expect(result.status).toBe(400); expect(mocks.owns).toHaveBeenCalledWith("ten_alpha", "/api/settings/branding/assets/asset_beta", expect.objectContaining({ query: mocks.query }));
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("honors a policy lock re-read in the transaction", async () => {
  mocks.query.mockResolvedValue({ rows: [{ locked_keys: ["displayName"] }] });
  expect((await POST(request({ displayName: "Revised" }))).status).toBe(400); expect(mocks.write).not.toHaveBeenCalled();
});
