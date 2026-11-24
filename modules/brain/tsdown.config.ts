import { libraryConfig } from "../../tooling/build/library.config.mts";

const config = libraryConfig({
  "index": "src/index.ts",
  "manifest": "src/manifest.ts",
  "BrainSurface": "src/BrainSurface.tsx"
});

config.copy = [...(config.copy as object[]), { from: "../../tooling/migrations/sql/tenant-brain", to: "sql/tenant-brain" }];
export default config;
