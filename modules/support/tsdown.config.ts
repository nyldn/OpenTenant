import { libraryConfig } from "../../tooling/build/library.config.mts";

const config = libraryConfig({
  "index": "src/index.ts",
  "host-context": "src/host-context.ts",
  "manifest": "src/manifest.ts",
  "SupportSurface": "src/SupportSurface.tsx"
});

config.copy = [...(config.copy as object[]), { from: "../../tooling/migrations/sql/tenant-support", to: "sql/tenant-support" }];
export default config;
