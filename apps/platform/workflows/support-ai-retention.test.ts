import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), connect: vi.fn(), construct: vi.fn(), config: new Map<string, string>() }));
vi.mock("pg", () => ({ Client: class { constructor(options: unknown) { state.construct(options); } connect = state.connect; query = state.query; end = state.end; } }));
vi.mock("../lib/server-config", () => ({ supportAiRetentionConfig: () => state.config }));
import { purgeSupportAiTicketContent } from "./support-ai-retention";
beforeEach(() => { vi.clearAllMocks(); state.config.clear(); state.end.mockResolvedValue(undefined); state.query.mockReset().mockResolvedValue({ rows: [] }); state.connect.mockResolvedValue(undefined); });
it("does no database work without an explicitly bound privileged connection", async () => {
  await purgeSupportAiTicketContent("tenant_a"); expect(state.construct).not.toHaveBeenCalled();
});
it("binds tenant context, limits SQL time and invokes the retention/missing-ticket hook", async () => {
  state.config.set("tenant_a", "postgresql://operator:secret-canary@db.example.test/tenant_a");
  await purgeSupportAiTicketContent("tenant_a");
  expect(state.query).toHaveBeenCalledWith("select set_config('app.tenant_id',$1,true)", ["tenant_a"]);
  expect(state.query).toHaveBeenCalledWith("set local statement_timeout='5s'");
  expect(state.query).toHaveBeenCalledWith("select support.purge_ai_suggestion_content()");
  expect(state.query).toHaveBeenLastCalledWith("commit");
  expect(state.end).toHaveBeenCalled();
});
it("rejects a shared foreign tenant database, rolls back and closes its own connection", async () => {
  state.config.set("tenant_a", "synthetic");
  state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("where tenant_id<>") ? [{}] : [] }));
  await expect(purgeSupportAiTicketContent("tenant_a")).rejects.toThrow(/^Support AI retention failed$/);
  expect(state.query).not.toHaveBeenCalledWith("select support.purge_ai_suggestion_content()");
  expect(state.query).toHaveBeenLastCalledWith("rollback"); expect(state.end).toHaveBeenCalled();
});
it("redacts connect and SQL errors and never logs a secret", async () => {
  state.config.set("tenant_a", "secret-canary");
  const log = vi.spyOn(console, "error");
  state.connect.mockRejectedValueOnce(new Error("secret-canary"));
  await expect(purgeSupportAiTicketContent("tenant_a")).rejects.toThrow(/^Support AI retention failed$/);
  state.query.mockRejectedValueOnce(new Error("secret-canary"));
  await expect(purgeSupportAiTicketContent("tenant_a")).rejects.toThrow(/^Support AI retention failed$/);
  expect(log).not.toHaveBeenCalled(); expect(state.end).toHaveBeenCalledTimes(2); log.mockRestore();
});
