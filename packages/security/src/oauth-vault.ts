const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const PROVIDER_PATTERN = /^[a-z0-9_-]{1,40}$/;

export function oauthVaultAad(tenantId: string, provider: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error("tenantId must be 1-128 chars of [a-zA-Z0-9_-]");
  }
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new Error("provider must be 1-40 chars of [a-z0-9_-]");
  }
  return `oauth:${tenantId}:${provider}`;
}
