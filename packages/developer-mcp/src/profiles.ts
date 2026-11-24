import type { AssignablePermissionSlug } from "./slugs";

export const DEVELOPER_PROFILES = Object.freeze({
  "developer.readonly@1": Object.freeze([
    "module.dev.workspace.read",
    "module.dev.contract.read",
    "module.dev.evidence.read",
  ]),
  "developer.builder@1": Object.freeze([
    "module.dev.workspace.read",
    "module.dev.contract.read",
    "module.dev.evidence.read",
    "module.dev.workspace.create",
    "module.dev.workspace.lifecycle",
    "module.dev.build.execute",
    "module.dev.preview.open",
  ]),
} as const satisfies Readonly<Record<string, readonly AssignablePermissionSlug[]>>);

export type DeveloperProfileVersion = keyof typeof DEVELOPER_PROFILES;
