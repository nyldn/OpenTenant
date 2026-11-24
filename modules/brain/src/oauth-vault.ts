export { oauthVaultAad } from "@opentenant/security";
const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function quarantineAad(tenantId: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error("tenantId must be 1-128 chars of [a-zA-Z0-9_-]");
  }
  return `quarantine:${tenantId}`;
}
