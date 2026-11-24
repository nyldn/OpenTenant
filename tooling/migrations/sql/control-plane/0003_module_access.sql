-- Per-tenant, per-module access mode (platform feature; supersedes the
-- client-side password gate from the Assessment source repo with server-side
-- enforcement). Platform admins and tenant admins configure this within
-- their authorization boundary; the passcode itself is stored only as an
-- scrypt hash.

-- The registry is the authority for module existence (spec section 11).
insert into module_catalog (module_key, version, runtime, enabled_by_default)
values ('assessment', '1.0.0', 'native', false)
on conflict (module_key) do nothing;

create table module_access_policies (
  tenant_id text not null references tenants (tenant_id),
  module_key text not null references module_catalog (module_key),
  mode text not null check (mode in ('identity', 'passcode')),
  -- scrypt hash, format: scrypt$N$r$p$salt_b64$hash_b64. Present exactly when
  -- mode='passcode', so switching a tenant back to identity mode cannot leave
  -- a dormant credential behind.
  passcode_hash text,
  constraint passcode_hash_matches_mode check ((mode = 'passcode') = (passcode_hash is not null)),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

comment on table module_access_policies is 'architecture spec sections 10-11; access mode per tenant module';
