import { libraryConfig } from "../../tooling/build/library.config.mts";

export default libraryConfig({
  "control-plane": "src/control-plane.ts",
  "index": "src/index.ts",
  "tenant-core": "src/tenant-core.ts",
  "tenant-modules": "src/tenant-modules.ts"
});
