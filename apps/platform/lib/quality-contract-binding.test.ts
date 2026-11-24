import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ tenant: vi.fn(), session: vi.fn(), permissions: vi.fn(), record: vi.fn(), read: vi.fn(), evaluation: vi.fn(), readEvaluation: vi.fn(), construct: vi.fn() }));
vi.mock("./tenant", () => ({ currentTenant: state.tenant }));
vi.mock("./session", () => ({ currentSession: state.session }));
vi.mock("./module-access", () => ({ resolvePermissions: state.permissions }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => "trusted-pool" }));
vi.mock("@opentenant/database", async original => ({ ...await original<typeof import("@opentenant/database")>(), PgQualityContractStore: class {
  constructor(...args: unknown[]) { state.construct(...args); }
  recordContract = state.record; getContract = state.read; recordEvaluation = state.evaluation; getEvaluation = state.readEvaluation;
} }));
import { qualityContractBinding } from "./quality-contract-binding";
import { qualityContractPersistenceCodec } from "@opentenant/quality-contract";
const artifact = (version = "1.0.0") => ({ tenantId: "tenant_a", moduleKey: "example", moduleVersion: version, bytes: new TextEncoder().encode(version) });
beforeEach(() => {
  vi.clearAllMocks();
  state.tenant.mockResolvedValue({ tenantId: "tenant_a" });
  state.session.mockResolvedValue({ userId: "user_a", activeTenantId: "tenant_a", isPlatformAdmin: false, expiresAt: new Date(Date.now() + 60_000) });
  state.permissions.mockResolvedValue(["module.dev.contract.read", "module.dev.contract.write", "module.dev.evidence.read", "module.dev.evidence.write"]);
});
it("composes the trusted codec and binds bytes, active tenant and actor, ignoring forged fields", async () => {
  const resolve = vi.fn(async () => artifact());
  const binding = qualityContractBinding(resolve);
  const input = { submissionId: "id", reason: "review", contract: {}, tenantId: "tenant_b", recordedByUserId: "user_b", artifactDigest: "forged" };
  await binding.recordContract("candidate", input);
  expect(state.construct).toHaveBeenCalledWith("trusted-pool", qualityContractPersistenceCodec);
  expect(resolve).toHaveBeenCalledWith("tenant_a", "candidate");
  expect(state.record).toHaveBeenCalledWith({ submissionId: "id", reason: "review", contract: {}, tenantId: "tenant_a", recordedByUserId: "user_a", moduleKey: "example", moduleVersion: "1.0.0", artifactDigest: createHash("sha256").update(artifact().bytes).digest("hex") });
  await binding.getContract("candidate", "record"); await binding.getEvaluation("evaluation");
  expect(state.read).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_a", readerUserId: "user_a", contractRecordId: "record" }));
  expect(state.readEvaluation).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_a", readerUserId: "user_a" }));
});
it("binds both evaluation references and refuses a context switch between them", async () => {
  const binding = qualityContractBinding(async (_tenant, target) => artifact(target === "baseline" ? "1.0.0" : "2.0.0"));
  const input = { submissionId: "id", reason: "review", baselineContractRecordId: "baseline", candidateContractRecordId: "candidate", baselineRun: {}, candidateRun: {} };
  await binding.recordEvaluation(input);
  expect(state.evaluation).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_a", recordedByUserId: "user_a", baseline: expect.objectContaining({ tenantId: "tenant_a", moduleVersion: "1.0.0" }), candidate: expect.objectContaining({ tenantId: "tenant_a", moduleVersion: "2.0.0" }) }));
  state.session.mockResolvedValueOnce({ userId: "user_a", activeTenantId: "tenant_a", expiresAt: new Date(Date.now() + 60_000) }).mockResolvedValueOnce({ userId: "user_b", activeTenantId: "tenant_a", expiresAt: new Date(Date.now() + 60_000) });
  await expect(binding.recordEvaluation(input)).rejects.toThrow("Quality persistence binding");
  expect(state.evaluation).toHaveBeenCalledTimes(1);
});
it("fails closed when unconfigured, unauthenticated, cross-tenant, expired or revoked", async () => {
  const binding = qualityContractBinding(async () => artifact());
  await expect(qualityContractBinding().getContract("candidate", "id")).rejects.toThrow("binding");
  for (const session of [null, { activeTenantId: "tenant_b" }, { activeTenantId: "tenant_a", isPlatformAdmin: true }, { activeTenantId: "tenant_a", expiresAt: new Date(0) }]) {
    state.session.mockResolvedValueOnce(session);
    await expect(binding.getContract("candidate", "id")).rejects.toThrow("binding");
  }
  state.permissions.mockResolvedValue([]);
  await expect(binding.getContract("candidate", "id")).rejects.toThrow("binding");
  await expect(binding.recordContract("candidate", { submissionId: "id", reason: "r", contract: {} })).rejects.toThrow("binding");
  expect(state.record).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
});
it("refuses foreign artifact custody and redacts dependency errors without logging", async () => {
  const log = vi.spyOn(console, "error");
  await expect(qualityContractBinding(async () => ({ ...artifact(), tenantId: "tenant_b" })).getContract("candidate", "id")).rejects.toThrow("binding");
  state.read.mockRejectedValueOnce(new Error("secret-canary"));
  await expect(qualityContractBinding(async () => artifact()).getContract("candidate", "id")).rejects.toThrow(/^Quality persistence integrity$/);
  expect(log).not.toHaveBeenCalled(); log.mockRestore();
});
