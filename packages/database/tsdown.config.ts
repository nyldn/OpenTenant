import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "index": "src/index.ts",
  "module-host": "src/module-host.ts",
  "audit-checkpoints": "src/audit-checkpoints.ts",
  "credential-config": "src/credential-config.ts"
});
