import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BrainSurface, brainSearchResults, type BrainBrowserAvailability } from "./BrainSurface";

// The frozen workspace has two React patch versions. Render shared primitives
// with their own renderer and the same React instance, as the host bundler does.
vi.mock("react", () => createRequire(new URL("../../../packages/design-system/package.json", import.meta.url))("react"));
const { renderToStaticMarkup } = createRequire(new URL("../../../packages/design-system/package.json", import.meta.url))("react-dom/server") as typeof import("react-dom/server");

describe("BrainSurface", () => {
  it.each([
    [{ state: "unavailable" }, "Brain browser authorization and search are not configured"],
    [{ state: "api-only" }, "tenant-authorized API only"],
    [{ state: "local", contextToken: "read-only-context" }, "Local deterministic search uses token hashing"],
    [{ state: "configured", contextToken: "read-only-context" }, "Brain search is configured by your tenant administrator"],
    [{ state: "denied" }, "Access denied"],
  ] as [BrainBrowserAvailability, string][])("renders an honest %j state with one heading", (availability, copy) => {
    const html = renderToStaticMarkup(<BrainSurface availability={availability} apiPath="/api/context" />);
    expect(html).toContain(copy);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/<main[ >]/g)).toHaveLength(1);
    if (availability.state === "local" || availability.state === "configured") {
      expect(html).toContain('data-slot="form-field"');
      expect(html).toContain('type="search"');
      expect(html).toContain('data-slot="empty"');
      expect(html).not.toContain("read-only-context");
    } else {
      expect(html).not.toContain("<form");
      expect(html).toContain('href="/"');
    }
  });
  it("defaults to unavailable without claiming that search is configured", () => {
    expect(renderToStaticMarkup(<BrainSurface />)).toContain("Brain browser tools unavailable");
  });
  it("reads the existing MCP search response as plain tenant text", () => {
    expect(brainSearchResults({ resultType: "complete", content: [{ type: "text", text: JSON.stringify([
      { id: "signal", content: "<script>tenant text</script>", score: 1, validated: [] },
    ]) }] })).toEqual([{ id: "signal", content: "<script>tenant text</script>" }]);
  });
  it.each([null, {}, { resultType: "complete", content: [{ type: "text", text: "{}" }] },
    { resultType: "complete", content: [{ type: "text", text: '[{"id":"signal"}]' }] },
  ])("rejects malformed API content instead of calling it an empty result", body => {
    expect(() => brainSearchResults(body)).toThrow();
  });
});
