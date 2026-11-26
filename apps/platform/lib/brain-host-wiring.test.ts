import { expect, it, vi } from "vitest";
import { BRAIN_API_PATH } from "@opentenant/brain/manifest";
import { installedModules } from "../opentenant-modules";

const { brainEmbeddingConfig } = vi.hoisted(() => ({
  brainEmbeddingConfig: vi.fn(() => undefined),
}));
vi.mock("./server-config", () => ({ brainEmbeddingConfig }));

it("resolves the host embedding binding when the registered Brain route runs", async () => {
  const route = installedModules.apiRoute(BRAIN_API_PATH)!;
  const request = new Request("https://tenant.example.test/api/mcp/brain", { method: "POST" });

  expect(brainEmbeddingConfig).not.toHaveBeenCalled();
  const result = await route.handle(request, { serverConfig: () => ({}) });
  expect(brainEmbeddingConfig).toHaveBeenCalledOnce();
  expect(await result.json()).toMatchObject({ error: { code: "module_signing_not_configured" } });
});
