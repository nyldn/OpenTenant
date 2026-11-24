import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Isolate S5's existing dev regression while V1 owns the phase registration
// for the new production spec. This does not replace the production proof.
export default defineConfig({
  testDir: "../specs", testMatch: "assessment.spec.ts", workers: 1,
  retries: 0, forbidOnly: true, timeout: 120_000, expect: { timeout: 15_000 },
  globalSetup: "../global-setup.ts", reporter: [["list"]],
  outputDir: "../test-results/assessment-isolated",
  use: { baseURL: process.env.LOCAL_PUBLIC_ORIGIN!, serviceWorkers: "block" },
  webServer: {
    command: "node platform-server.mjs", cwd: resolve(import.meta.dirname, ".."),
    url: `${process.env.LOCAL_PUBLIC_ORIGIN}/opentenant-logo.svg`, reuseExistingServer: false,
    timeout: 120_000, gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
