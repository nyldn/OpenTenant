-- Tenant-private raster assets. Every host read and selection binds tenant_id.
create table tenant_branding_assets (
  asset_id text not null check (asset_id ~ '^asset_[a-zA-Z0-9_-]{1,100}$'),
  tenant_id text not null references tenants(tenant_id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  content bytea not null check (octet_length(content) between 1 and 1048576),
  created_at timestamptz not null default now(),
  primary key (tenant_id, asset_id)
);
comment on table tenant_branding_assets is 'Control-plane tenant-bound raster assets; host reads and mutations require the resolved tenant_id.';
