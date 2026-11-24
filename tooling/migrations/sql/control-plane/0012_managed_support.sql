alter table tenants
  add column managed_support_enabled boolean not null default false;

create table installation_metadata (
  singleton boolean primary key default true check (singleton),
  installation_id text not null unique
);

insert into installation_metadata (singleton, installation_id)
values (true, 'ins_' || gen_random_uuid()::text);

comment on table installation_metadata is
  'One generated installation identity per OpenTenant control plane';

create table managed_support_sessions (
  session_id text primary key,
  token_hash text not null unique,
  installation_id text not null references installation_metadata (installation_id),
  tenant_id text not null references tenants (tenant_id),
  operator_user_id text not null references platform_users (user_id),
  reason text not null check (length(reason) between 8 and 500),
  reference text check (reference is null or length(reference) between 1 and 120),
  allowed_action_classes jsonb not null default '["routine_configuration"]',
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint managed_support_expiry_after_creation check (expires_at > created_at),
  constraint managed_support_action_classes_array check (jsonb_typeof(allowed_action_classes) = 'array')
);

create index managed_support_sessions_tenant_active_idx
  on managed_support_sessions (tenant_id, expires_at) where revoked_at is null;

comment on table managed_support_sessions is
  'Opaque short-lived owner support contexts; never tenant memberships or provider impersonation';

alter table domains
  add column display_label text,
  add column verification_note text;

alter table oauth_token_vault
  add column display_name text,
  add column health_note text;

comment on column domains.verification_note is
  'Non-sensitive operator note; does not change verification or activation state';

comment on column oauth_token_vault.health_note is
  'Non-sensitive operator note; does not change provider, destination, scopes, credentials, or status';

create function revoke_support_sessions_when_disabled() returns trigger
language plpgsql as $$
begin
  if old.managed_support_enabled and not new.managed_support_enabled then
    update managed_support_sessions set revoked_at = now()
      where tenant_id = new.tenant_id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger tenants_revoke_support_sessions
  after update of managed_support_enabled on tenants
  for each row execute function revoke_support_sessions_when_disabled();
