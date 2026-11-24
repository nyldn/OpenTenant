import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("tenant UI distribution boundary", () => {
  it("uses only the built-in official shadcn registry", () => {
    const config = JSON.parse(projectFile("components.json")) as {
      registries: Record<string, unknown>;
    };

    expect(config.registries).toEqual({});
    expect(projectFile("components.json").toLowerCase()).not.toContain("studio");
  });

  it("defines semantic tenant brand tokens", () => {
    const css = projectFile("src/app/globals.css");
    expect(css).toContain("--primary:");
    expect(css).toContain("--background:");
    expect(css).toContain("--ring:");
  });
});
