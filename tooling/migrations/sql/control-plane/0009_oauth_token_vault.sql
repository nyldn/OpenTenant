-- Control-plane OAuth custody for platform-managed brain connectors. AAD for
-- every encrypted token is fixed to oauth:${tenantId}:${provider}.

create table oauth_token_vault (
  tenant_id text not null references tenants (tenant_id),
  provider text not null,
  encrypted_access_token text,
  encrypted_refresh_token text,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked', 'reauthorization_required')),
  expires_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aad text not null check (aad = 'oauth:' || tenant_id || ':' || provider),
  primary key (tenant_id, provider)
);

comment on table oauth_token_vault is 'Encrypted OAuth tokens for brain direct connectors; ciphertext format from CredentialCipher.';
