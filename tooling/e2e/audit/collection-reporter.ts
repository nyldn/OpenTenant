import { basename } from "node:path";
import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter";
import { CELLS, batchRoutes } from "./inventory.mjs";
import { PHASES } from "./phases.mjs";
export const collectionReporterPath = "./audit/collection-reporter.ts";
export default class CollectionReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite) {
    const phase = process.env.E2E_PHASE as keyof typeof PHASES;
    const contract = PHASES[phase];
    if (!contract) throw new Error("Unknown E2E identity phase");
    const tests = suite.allTests();
    if (tests.some(t => !(contract.specs as string[]).includes(basename(t.location.file)))) throw new Error("Spec collected under the wrong identity phase");
    if (["legacy", "journeys"].includes(phase) && process.env.IDENTITY_PROVIDER !== contract.provider && !process.argv.includes("--list")) throw new Error("Unexpected E2E identity provider");
    const count = phase === "audit" ? process.env.A11Y_LIST_ALL === "1" ? CELLS.length : batchRoutes(Number(process.env.A11Y_BATCH ?? 0)).length * 18 : contract.count;
    if (process.env.E2E_FILTERED !== "1" && tests.length !== count) throw new Error(`E2E collection mismatch for ${phase}: ${tests.length}/${count}`);
  }
}
