create table tenant_owner_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(tenant_id),
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  membership_id text,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  consumed_at timestamptz,
  claimed_user_id text,
  granted_at timestamptz
);
create unique index tenant_owner_one_live_invite on tenant_owner_invites(tenant_id) where revoked_at is null and consumed_at is null;
