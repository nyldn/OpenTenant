import { sqlAssets } from "./sql-assets.ts";
import { defineConfig } from "tsdown";
import { existsSync } from "node:fs";

/** Preserve module boundaries and React directives; externalize declared dependencies. */
export function libraryConfig(entry: Record<string, string>, unbundle = true) {
  return defineConfig({
    entry,
    format: "esm",
    platform: "node",
    fixedExtension: false,
    deps: { neverBundle: true },
    target: "es2022",
    dts: true,
    unbundle,
    sourcemap: false,
    clean: true,
    plugins: [sqlAssets()],
    copy: [
      { from: existsSync("LICENSE") ? "LICENSE" : "../../LICENSE", to: "dist" },
    ],
  });
}
