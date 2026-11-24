-- Transaction management is owned by the migration runner; do not add
-- begin/commit here.

create table tenants (
  tenant_id text primary key,
  slug text unique not null,
  display_name text not null,
  status text not null check (status in ('provisioning', 'active', 'suspended', 'deleted')),
  data_region text not null check (data_region in ('us', 'eu')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table tenants is 'architecture spec section 9.1';

create table identity_org_mappings (
  tenant_id text references tenants (tenant_id),
  provider text not null default 'workos',
  external_organization_id text not null,
  unique (provider, external_organization_id),
  primary key (tenant_id, provider)
);

comment on table identity_org_mappings is 'architecture spec section 9.1';

create table domains (
  host text primary key,
  tenant_id text not null references tenants (tenant_id),
  kind text not null check (kind in ('opentenant_subdomain', 'custom')),
  verification text not null default 'pending' check (verification in ('pending', 'verified', 'failed')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  -- A domain can only serve traffic after ownership verification passes.
  constraint domains_active_requires_verified check (not active or verification = 'verified')
);

comment on table domains is 'architecture spec section 9.1';

create table brand_policies (
  tenant_id text primary key references tenants (tenant_id),
  defaults jsonb not null default '{}',
  locked_keys jsonb not null default '[]',
  overrides jsonb not null default '{}',
  version integer not null default 1
);

comment on table brand_policies is 'architecture spec section 9.1';

create table module_catalog (
  module_key text primary key,
  version text not null,
  runtime text not null check (runtime in ('native', 'remote')),
  enabled_by_default boolean not null default false
);

comment on table module_catalog is 'architecture spec section 9.1';

create table tenant_modules (
  tenant_id text references tenants (tenant_id),
  module_key text references module_catalog (module_key),
  enabled boolean not null default false,
  settings jsonb not null default '{}',
  primary key (tenant_id, module_key)
);

comment on table tenant_modules is 'architecture spec section 9.1';

create table navigation_overrides (
  tenant_id text references tenants (tenant_id),
  item_id text not null,
  label text,
  group_name text,
  sort_order integer,
  visible boolean,
  locked_fields jsonb not null default '[]',
  version integer not null default 1,
  primary key (tenant_id, item_id)
);

comment on table navigation_overrides is 'architecture spec section 9.1';

create table tenant_databases (
  tenant_id text primary key references tenants (tenant_id),
  provider text not null default 'neon',
  region text not null,
  encrypted_connection bytea not null,
  schema_version text,
  updated_at timestamptz not null default now()
);

comment on table tenant_databases is 'architecture spec section 9.1';

create table provisioning_jobs (
  job_id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants (tenant_id),
  kind text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'failed', 'completed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table provisioning_jobs is 'architecture spec section 9.1';

create table audit_events (
  id bigserial primary key,
  sequence bigint not null,
  tenant_id text references tenants (tenant_id),
  occurred_at timestamptz not null,
  actor jsonb not null,
  action text not null,
  subject text not null,
  detail jsonb not null default '{}',
  previous_hash text not null,
  hash text not null,
  -- nulls not distinct so platform-scoped (tenant_id is null) sequences are
  -- unique too; plain unique would let duplicates break the hash chain.
  unique nulls not distinct (tenant_id, sequence)
);

comment on table audit_events is 'architecture spec section 9.1';

-- Append-only enforcement: the audit trail is tamper-evident by hash chain
-- and tamper-resistant by trigger (spec section 14).
create function audit_events_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on audit_events
  for each row execute function audit_events_block_mutation();

create index domains_tenant_id_idx on domains (tenant_id);
create index audit_events_tenant_id_occurred_at_idx on audit_events (tenant_id, occurred_at);
create index provisioning_jobs_status_idx on provisioning_jobs (status);
