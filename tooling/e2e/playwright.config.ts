import { collectionReporterPath } from "./audit/collection-reporter";
import { defineConfig, devices } from "@playwright/test";
import { PHASES, validateRegistration } from "./audit/phases.mjs";
import { tenants } from "./tenants.mjs";

if (!process.env.E2E_APP_PORT) throw new Error("Run the suite with pnpm e2e");

const phase = process.env.E2E_PHASE;
const standalone = phase === "audit" || phase === "reset";
validateRegistration();
const contract = PHASES[phase as keyof typeof PHASES];
if (!contract) throw new Error("Unknown E2E identity phase");
if ("runner" in contract) throw new Error(`Run the ${phase} phase with ${contract.runner}`);
export default defineConfig({
  testDir: "./specs",
  testMatch: contract.specs.map(file => `**/${file}`),
  outputDir: `test-results/${phase}`,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  maxFailures: phase === "audit" ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [[collectionReporterPath], ["list"], ["json", { outputFile: `test-results/${phase}/results.json` }], ["html", { open: "never", outputFolder: `playwright-report/${phase}` }]],
  ...(standalone ? {} : { globalSetup: "./global-setup.ts" }),
  use: {
    baseURL: process.env.LOCAL_PUBLIC_ORIGIN!,
    trace: standalone ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    launchOptions: { args: [
      `--host-resolver-rules=${["unknown.example.test", "onboard.example.test", ...tenants.map(({ slug }) => `${slug}.example.test`)]
        .map((host) => `MAP ${host} 127.0.0.1`).join(",")}`,
      "--no-proxy-server",
    ] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(standalone ? {} : { webServer: {
    command: "node platform-server.mjs",
    url: `${process.env.LOCAL_PUBLIC_ORIGIN}/opentenant-logo.svg`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  } }),
});
