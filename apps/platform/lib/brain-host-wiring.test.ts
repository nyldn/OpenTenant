import { beforeEach, expect, it, vi } from "vitest";
import { BRAIN_MODULE } from "@opentenant/brain/manifest";
const state = vi.hoisted(() => ({ handle: vi.fn(), embedding: undefined as unknown }));
vi.mock("@opentenant/brain", () => ({ handleBrainRequest: state.handle }));
vi.mock("./server-config", () => ({ brainEmbeddingConfig: () => state.embedding }));
import { installedModules } from "../opentenant-modules";
beforeEach(() => { state.handle.mockReset().mockResolvedValue(new Response("ok")); });
it.each([false, true])("passes typed embedding and the actual HTTP signal, configured=%s", async configured => {
  const embedding = { apiKey: "secret-canary", model: "embedding-snapshot", region: "eu" };
  state.embedding = configured ? embedding : undefined;
  const request = new Request("https://tenant.example.test/api/mcp/brain", { method: "POST" });
  const services = { trusted: true };
  const route = installedModules.get(BRAIN_MODULE.manifest.key)!.apiRoutes![0]!;
  await route.handle(request, services);
  expect(state.handle).toHaveBeenCalledWith(request, services, { ...(configured ? { embedding } : {}), signal: request.signal });
  expect(state.handle.mock.lastCall?.[2].signal).toBe(request.signal);
});
