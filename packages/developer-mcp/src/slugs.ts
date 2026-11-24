export const DEVELOPER_PERMISSION_SLUGS = Object.freeze([
  "module.dev.workspace.read",
  "module.dev.workspace.create",
  "module.dev.workspace.lifecycle",
  "module.dev.contract.read",
  "module.dev.build.execute",
  "module.dev.preview.open",
  "module.dev.evidence.read",
  "module.dev.publish.propose",
  "module.dev.publish",
  "module.dev.infrastructure.approve",
] as const);

export type DeveloperPermissionSlug = (typeof DEVELOPER_PERMISSION_SLUGS)[number];
export type DeveloperRiskClass = "low" | "medium" | "high";

export const ASSIGNABLE_PERMISSION_SLUGS = Object.freeze([
  "module.dev.workspace.read",
  "module.dev.workspace.create",
  "module.dev.workspace.lifecycle",
  "module.dev.contract.read",
  "module.dev.build.execute",
  "module.dev.preview.open",
  "module.dev.evidence.read",
] as const satisfies readonly DeveloperPermissionSlug[]);

export type AssignablePermissionSlug = (typeof ASSIGNABLE_PERMISSION_SLUGS)[number];

export const UNASSIGNABLE_PERMISSION_SLUGS = Object.freeze([
  "module.dev.publish.propose",
  "module.dev.publish",
  "module.dev.infrastructure.approve",
] as const satisfies readonly DeveloperPermissionSlug[]);

export type UnassignablePermissionSlug = (typeof UNASSIGNABLE_PERMISSION_SLUGS)[number];

export const DEVELOPER_PERMISSION_RISKS = Object.freeze({
  "module.dev.workspace.read": "low",
  "module.dev.workspace.create": "medium",
  "module.dev.workspace.lifecycle": "medium",
  "module.dev.contract.read": "low",
  "module.dev.build.execute": "high",
  "module.dev.preview.open": "high",
  "module.dev.evidence.read": "low",
  "module.dev.publish.propose": "medium",
  "module.dev.publish": "high",
  "module.dev.infrastructure.approve": "high",
} as const satisfies Readonly<Record<DeveloperPermissionSlug, DeveloperRiskClass>>);

const assignableSlugSet: ReadonlySet<string> = new Set(ASSIGNABLE_PERMISSION_SLUGS);
const unassignableSlugSet: ReadonlySet<string> = new Set(UNASSIGNABLE_PERMISSION_SLUGS);
const developerSlugSet: ReadonlySet<string> = new Set(DEVELOPER_PERMISSION_SLUGS);

export function isAssignablePermissionSlug(value: string): value is AssignablePermissionSlug {
  return assignableSlugSet.has(value);
}

export function isUnassignablePermissionSlug(value: string): value is UnassignablePermissionSlug {
  return unassignableSlugSet.has(value);
}

export function isDeveloperPermissionSlug(value: string): value is DeveloperPermissionSlug {
  return developerSlugSet.has(value);
}
