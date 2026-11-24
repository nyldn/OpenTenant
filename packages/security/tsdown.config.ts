import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "index": "src/index.ts",
  "audit-checkpoint": "src/audit-checkpoint.ts",
  "checkpoint-sinks": "src/checkpoint-sinks.ts",
  "audit-chain": "src/audit-chain.ts",
  "canonical-json": "src/canonical-json.ts",
  "subprocess": "src/subprocess.ts"
});
