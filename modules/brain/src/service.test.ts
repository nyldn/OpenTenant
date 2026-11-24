import { beforeEach, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { BRAIN_MODULE } from "./manifest";
const run = vi.hoisted(() => vi.fn(async (_deps: import("./mcp-service").BrainMcpDependencies, ..._args: unknown[]) => null));
vi.mock("./mcp-service", () => ({ executeBrainTool: run }));
import { brainCall } from "./service";
beforeEach(() => run.mockClear());
const host = (mode?: string) => ({ serverConfig: () => ({ NODE_ENV: mode }), modelRouter: () => ({ resolve: vi.fn() }), withTenantDb: vi.fn() }) as unknown as ModuleHostServices;
it("declares the execution mode through its manifest and denies production local embeddings", async () => {
  expect(BRAIN_MODULE.environmentKeys).toContain("NODE_ENV"); await brainCall(host("production"), "tenant", "user", ["brain.use"], "search", { query: "example" });
  expect(run.mock.calls[0]![0].embeddingAdapters.size).toBe(0);
});
it("composes local embeddings only for explicit development mode", async () => {
  await brainCall(host("development"), "tenant", "user", ["brain.use"], "search", { query: "example" });
  expect(run.mock.calls[0]![0].embeddingAdapters.has("local")).toBe(true);
});
it("fails closed when a host omits the declared execution mode", async () => {
  await brainCall(host(), "tenant", "user", ["brain.use"], "search", { query: "example" }); expect(run.mock.calls[0]![0].embeddingAdapters.size).toBe(0);
});
