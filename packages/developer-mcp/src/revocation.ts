import { DEVELOPER_PERMISSION_RISKS, isDeveloperPermissionSlug } from "./slugs";

export const MAX_AUTHORITY_STALENESS_MS = 60_000 as const;

export function requiresSynchronousRevocationCheck(slug: string): boolean {
  if (!isDeveloperPermissionSlug(slug)) return true;
  return DEVELOPER_PERMISSION_RISKS[slug] === "high";
}
