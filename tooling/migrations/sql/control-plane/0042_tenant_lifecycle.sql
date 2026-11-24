alter table tenants add column deleted_at timestamptz;
alter table tenants add column erase_after timestamptz;
alter table tenants add column database_erased_at timestamptz;
alter table tenants add constraint tenant_erase_requires_deleted check (erase_after is null or status='deleted');
create index tenants_due_erase on tenants(erase_after) where status='deleted';
create table tenant_export_archives (
  id uuid primary key,
  tenant_id text not null references tenants(tenant_id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
