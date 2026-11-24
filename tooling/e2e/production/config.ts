import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Separate from the dev phase registry. V1 must wire this production command
// explicitly; a dev server must never satisfy these measurements.
export default defineConfig({
  testDir: "../specs", testMatch: "production-budgets.spec.ts",
  outputDir: "../test-results/production/artifacts", workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: true, timeout: 900_000, expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: resolve(import.meta.dirname, "../test-results/production/results.json") }]],
  use: { serviceWorkers: "block", trace: "off", screenshot: "only-on-failure", navigationTimeout: 30_000, actionTimeout: 15_000, launchOptions: { args: ["--no-proxy-server"] } },
});
