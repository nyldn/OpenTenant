import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialCipher } from "../../../packages/database/src/credential-cipher";
import { NeonCredentialRotation } from "./app-role-neon";
import { PostgresCredentialRotation, rotateCredentialWithCheckpoint, type RotationCheckpointStore } from "./app-role-rotation";
const query = vi.hoisted(() => vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ exists: false }] })));
const end = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("pg", () => ({ Client: class { connect = vi.fn(); query = query; end = end; } }));
const target = { projectId: "synthetic-project", branchId: "synthetic-branch", hostname: "ep-synthetic.us-east-1.aws.neon.tech" };
const request = { ownerConnectionUri: `postgresql://owner:synthetic@${target.hostname}/tenant?sslmode=verify-full`, roleName: "tenant_app", runId: "synthetic-run" };
function fixture() {
  const password = randomBytes(32).toString("base64url");
  const resetRolePassword = vi.fn(async () => ({ password }));
  const provider = new NeonCredentialRotation(target, { resetRolePassword });
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  const records = new Map<string, string>();
  let locked = false, reserved: string | null = null;
  const checkpoints: RotationCheckpointStore = {
    async withLock(_target, runId, work) { if (locked || (reserved !== null && reserved !== runId)) throw new Error("Synthetic lock busy"); locked = true; reserved = runId; try { const result = await work(); reserved = null; return result; } finally { locked = false; } },
    async load(id) { return records.get(id) ?? null; },
    async save(id, value) { records.set(id, value); },
  };
  const activate = vi.fn(async (_uri: string) => {});
  return { password, resetRolePassword, records, deps: { provider, cipher, checkpoints, activate } };
}
beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [{ exists: false }] }); end.mockReset().mockResolvedValue(); });
describe("API application credential rotation", () => {
  it.each([false, true])("keeps passwords out of SQL and logs and preserves grants, existing=%s", async exists => {
    query.mockResolvedValue({ rows: [{ exists }] });
    const f = fixture();
    const logs = ["log", "warn", "info", "error", "debug"].map(method => vi.spyOn(console, method as "log").mockImplementation(() => {}));
    try {
      await rotateCredentialWithCheckpoint(f.deps, request);
      const statements = query.mock.calls.map(call => call[0]).join("\n");
      expect(statements.includes(f.password)).toBe(false);
      expect(/\bpassword\b/iu.test(statements)).toBe(false);
      expect(JSON.stringify(query.mock.calls).includes(f.password)).toBe(false);
      expect(logs.every(log => log.mock.calls.length === 0)).toBe(true);
      expect(statements).toContain("login nobypassrls nosuperuser nocreatedb nocreaterole noreplication");
      for (const grant of ["grant usage on schema tenant_core", "grant select, insert, update on all tables", "grant usage, select on all sequences", "alter default privileges in schema tenant_core grant select, insert, update", "alter default privileges in schema tenant_core grant usage, select"]) expect(statements).toContain(grant);
      expect(f.resetRolePassword).toHaveBeenCalledOnce();
      expect(f.resetRolePassword).toHaveBeenCalledWith({ projectId: target.projectId, branchId: target.branchId, roleName: request.roleName });
      expect([...f.records.values()].every(value => !value.includes(f.password) && !value.includes("postgresql://"))).toBe(true);
      const uri = new URL(f.deps.activate.mock.calls[0]![0]);
      expect(decodeURIComponent(uri.password) === f.password).toBe(true);
      expect(uri.hostname).toBe("ep-synthetic-pooler.us-east-1.aws.neon.tech");
    } finally { logs.forEach(log => log.mockRestore()); }
  });
  it("recovers failed activation from an authenticated encrypted checkpoint without another reset", async () => {
    const f = fixture();
    f.deps.activate.mockRejectedValueOnce(new Error("Synthetic store failure"));
    await expect(rotateCredentialWithCheckpoint(f.deps, request)).rejects.toThrow("resume the same run");
    const firstUri = f.deps.activate.mock.calls[0]![0];
    await rotateCredentialWithCheckpoint(f.deps, request);
    expect(f.resetRolePassword).toHaveBeenCalledOnce();
    expect(f.deps.activate.mock.calls[1]![0] === firstUri).toBe(true);
    await rotateCredentialWithCheckpoint(f.deps, request);
    expect(f.deps.activate).toHaveBeenCalledTimes(2);
  });
  it("reserves an incomplete target across runs so stale recovery cannot replace a later credential", async () => {
    const f = fixture();
    f.deps.activate.mockRejectedValueOnce(new Error("Synthetic store failure"));
    await expect(rotateCredentialWithCheckpoint(f.deps, request)).rejects.toThrow();
    await expect(rotateCredentialWithCheckpoint(f.deps, { ...request, runId: "different-run" })).rejects.toThrow();
    expect(f.resetRolePassword).toHaveBeenCalledOnce();
    await rotateCredentialWithCheckpoint(f.deps, request);
    await rotateCredentialWithCheckpoint(f.deps, { ...request, runId: "different-run" });
    expect(f.resetRolePassword).toHaveBeenCalledTimes(2);
    const activations = f.deps.activate.mock.calls.length;
    await rotateCredentialWithCheckpoint(f.deps, request);
    expect(f.deps.activate).toHaveBeenCalledTimes(activations);
  });
  it("retries after a failed rotated-checkpoint write before any activation", async () => {
    const f = fixture(), save = f.deps.checkpoints.save;
    let writes = 0;
    f.deps.checkpoints.save = async (id, ciphertext) => { if (++writes === 2) throw new Error("Synthetic write failure"); await save(id, ciphertext); };
    await expect(rotateCredentialWithCheckpoint(f.deps, request)).rejects.toThrow("resume the same run");
    expect(f.deps.activate).not.toHaveBeenCalled();
    await rotateCredentialWithCheckpoint(f.deps, request);
    expect(f.resetRolePassword).toHaveBeenCalledTimes(2);
    expect(f.deps.activate).toHaveBeenCalledOnce();
  });
  it("fails closed on tampering and cross-target checkpoint replay", async () => {
    const f = fixture();
    f.deps.activate.mockRejectedValueOnce(new Error("Synthetic store failure"));
    await expect(rotateCredentialWithCheckpoint(f.deps, request)).rejects.toThrow();
    await expect(rotateCredentialWithCheckpoint(f.deps, { ...request, roleName: "other_app" })).rejects.toThrow("resume the same run");
    const checkpoint = f.records.get(request.runId)!;
    f.records.set(request.runId, checkpoint.slice(0, -8) + "invalid!");
    await expect(rotateCredentialWithCheckpoint(f.deps, request)).rejects.toThrow("resume the same run");
    expect(f.resetRolePassword).toHaveBeenCalledOnce();
    expect(f.deps.activate).toHaveBeenCalledOnce();
  });
  it("normalizes provider/driver exceptions without leaking response bodies", async () => {
    const f = fixture();
    f.resetRolePassword.mockRejectedValueOnce(new Error(f.password));
    let message = "";
    try { await rotateCredentialWithCheckpoint(f.deps, request); } catch (error) { message = (error as Error).message; }
    expect(message.includes(f.password)).toBe(false);
    expect(message).toBe("Application credential rotation failed; resume the same run");
    expect(f.deps.activate).not.toHaveBeenCalled();
  });
  it("normalizes cleanup failures before credential checkpoint or activation", async () => {
    const f = fixture();
    end.mockRejectedValueOnce(new Error(f.password));
    let message = "";
    try { await rotateCredentialWithCheckpoint(f.deps, request); } catch (error) { message = (error as Error).message; }
    expect(message.includes(f.password)).toBe(false);
    expect(message).toBe("Application credential rotation failed; resume the same run");
    expect(f.deps.activate).not.toHaveBeenCalled();
    expect(f.resetRolePassword).toHaveBeenCalledOnce();
  });
  it("rejects a mismatched endpoint and preserves local role membership/database grants", async () => {
    const f = fixture();
    await expect(f.deps.provider.rotate({ ...request, ownerConnectionUri: "postgresql://owner:synthetic@other.neon.tech/tenant?sslmode=verify-full" })).rejects.toThrow("Neon application credential rotation failed");
    expect(query).not.toHaveBeenCalled();
    await new PostgresCredentialRotation().rotate({ ownerConnectionUri: "postgresql://owner:synthetic@127.0.0.1/opentenant_synthetic", roleName: "synthetic_app" });
    const statements = query.mock.calls.map(call => call[0]).join("\n");
    expect(statements).toContain("grant tenant_app to synthetic_app");
    expect(statements).toContain('grant connect on database "opentenant_synthetic" to synthetic_app');
    expect(statements).toContain("nobypassrls nosuperuser nocreatedb nocreaterole noreplication");
  });
});
