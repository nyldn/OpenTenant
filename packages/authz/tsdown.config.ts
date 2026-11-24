import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "index": "src/index.ts",
  "adapters/openfga": "src/adapters/openfga.ts",
  "testing/index": "testing/index.ts"
}, false);
