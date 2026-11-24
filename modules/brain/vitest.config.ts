import { defineConfig } from "vitest/config";
import { sqlAssets } from "../../tooling/build/sql-assets";
export default defineConfig({ plugins: [sqlAssets()] });
