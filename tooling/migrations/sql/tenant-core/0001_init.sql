-- Tenant-core schema (architecture spec section 9.2).
-- Applied to every tenant project at provisioning. Each enabled module adds
-- its own schema (e.g. "assessment") in later migrations following the same RLS
-- pattern established here.

-- Transaction management is owned by the migration runner; do not add
-- begin/commit here.

create schema tenant_core;

comment on schema tenant_core is 'architecture spec section 9.2';

-- Single-row identity anchor: which tenant this project serves. Module rows
-- retain tenant_id/organization_id even though the project is single-tenant,
-- to keep export, audit, restore, and Azure migration straightforward.
create table tenant_core.tenant_meta (
  tenant_id text primary key,
  organization_id text not null,
  data_region text not null check (data_region in ('us', 'eu')),
  provisioned_at timestamptz not null default now()
);

-- Schema version per module for fleet migration tracking and drift detection.
create table tenant_core.module_schema_versions (
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  module_key text not null,
  version text not null,
  applied_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

-- Fail-closed row-level security pattern (spec 9.2): policies require the
-- transaction-scoped app.tenant_id context set by withTenantContext. FORCE
-- applies RLS even to the table owner, so a missing context yields zero rows
-- and writes fail, for every role.
alter table tenant_core.tenant_meta enable row level security;
alter table tenant_core.tenant_meta force row level security;
create policy tenant_meta_isolation on tenant_core.tenant_meta
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table tenant_core.module_schema_versions enable row level security;
alter table tenant_core.module_schema_versions force row level security;
create policy module_schema_versions_isolation on tenant_core.module_schema_versions
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
