import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "index": "src/index.ts",
  "logger": "src/logger.ts",
  "tracing": "src/tracing.ts",
  "node": "src/node.ts"
});
