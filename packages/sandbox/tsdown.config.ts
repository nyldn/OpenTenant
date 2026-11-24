import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "index": "src/index.ts",
  "testing/index": "src/testing/index.ts",
  "providers/e2b/adapter": "src/providers/e2b/adapter.ts",
  "providers/microsandbox/adapter": "src/providers/microsandbox/adapter.ts",
  "providers/configured": "src/providers/configured.ts"
});
