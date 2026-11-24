import { createHash } from "node:crypto";
import type { SandboxFileWrite, SandboxTemplateRef } from "./contracts";

export interface ApprovedModuleTemplate {
  readonly ref: SandboxTemplateRef;
  files(): readonly SandboxFileWrite[];
  readonly workingDirectory: string;
  readonly validationArtifactPath: string;
  readonly previewPort: number;
}

const encoder = new TextEncoder();

const SYNTHETIC_FILE_TEXT = Object.freeze({
  "workspace/app/package.json": JSON.stringify({
    name: "synthetic-tenant-module",
    private: true,
    packageManager: "pnpm@11.13.1",
    engines: { node: ">=22 <23" },
    scripts: { build: "fixture-build", test: "fixture-test", dev: "fixture-preview" },
  }, null, 2),
  "workspace/app/pnpm-lock.yaml": [
    "lockfileVersion: '9.0'",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "importers:",
    "  .: {}",
    "",
  ].join("\n"),
  "workspace/app/src/index.ts": [
    "export const moduleManifest = Object.freeze({",
    "  key: 'synthetic-example',",
    "  title: 'Synthetic Example',",
    "});",
    "",
  ].join("\n"),
  "workspace/app/src/index.test.ts": [
    "import { moduleManifest } from './index';",
    "if (moduleManifest.key !== 'synthetic-example') throw new Error('invalid fixture');",
    "",
  ].join("\n"),
  "workspace/app/dist/validation.json": JSON.stringify({
    fixture: "synthetic-module",
    schemaVersion: 1,
  }),
});

export function digestTemplateFiles(files: readonly SandboxFileWrite[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.contents);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function syntheticTemplateFiles(): SandboxFileWrite[] {
  return Object.entries(SYNTHETIC_FILE_TEXT).map(([path, contents]) => ({
    path,
    contents: encoder.encode(contents),
  }));
}

const SYNTHETIC_TEMPLATE_REF = Object.freeze({
  id: "opentenant.synthetic-module",
  version: "1.0.0",
  digest: digestTemplateFiles(syntheticTemplateFiles()),
});

export const SYNTHETIC_MODULE_TEMPLATE: ApprovedModuleTemplate = Object.freeze({
  ref: SYNTHETIC_TEMPLATE_REF,
  workingDirectory: "workspace/app",
  validationArtifactPath: "workspace/app/dist/validation.json",
  previewPort: 3000,
  files: syntheticTemplateFiles,
});
