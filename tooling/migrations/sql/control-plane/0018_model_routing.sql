-- Provider-neutral model policy and evidence. Provider SDK objects and raw
-- credentials are deliberately absent from this schema.

create table model_allowlist_versions (
  allowlist_version text primary key,
  require_zero_retention boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (length(btrim(allowlist_version)) > 0),
  check (length(btrim(created_by)) > 0)
);

create table model_allowlist_entries (
  allowlist_version text not null references model_allowlist_versions(allowlist_version),
  provider text not null,
  model text not null,
  region text not null check (region in ('us', 'eu', 'ap')),
  retention_posture text not null
    check (retention_posture in ('zero_retention', 'provider_default', 'unverified')),
  pinned_upstream boolean not null default false,
  primary key (allowlist_version, provider, model),
  check (provider <> 'openrouter' or pinned_upstream)
);

create table tenant_model_policies (
  tenant_id text primary key references tenants(tenant_id),
  require_zero_retention boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

-- Scope encodes the ADR cascade. NULLS NOT DISTINCT makes each optional scope
-- component unique while retaining a real tenant foreign key.
create table model_routing_slots (
  tenant_id text references tenants(tenant_id),
  module_id text,
  use_case text,
  scope text not null check (
    (scope = 'tenant_module_use_case' and tenant_id is not null and module_id is not null and use_case is not null)
    or (scope = 'tenant_module_default' and tenant_id is not null and module_id is not null and use_case is null)
    or (scope = 'installation_use_case' and tenant_id is null and module_id is null and use_case is not null)
    or (scope = 'installation_default' and tenant_id is null and module_id is null and use_case is null)
    or (scope = 'platform_default' and tenant_id is null and module_id is null and use_case is null)
  ),
  slot text not null check (slot in ('primary', 'secondary')),
  provider text not null,
  model text not null,
  configured_by text not null,
  configured_at timestamptz not null default now()
);

create unique index model_routing_slots_scope_idx on model_routing_slots
  (scope, tenant_id, module_id, use_case, slot) nulls not distinct;

create table model_cross_border_consents (
  consent_id text primary key,
  tenant_id text not null references tenants(tenant_id),
  actor_id text not null,
  granted_at timestamptz not null,
  policy_version text not null,
  withdrawn_by text,
  withdrawn_at timestamptz,
  check ((withdrawn_by is null) = (withdrawn_at is null)),
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);

create unique index model_cross_border_active_consent_idx
  on model_cross_border_consents (tenant_id) where withdrawn_at is null;

create table model_cross_border_consent_pairs (
  consent_id text not null references model_cross_border_consents(consent_id),
  provider text not null,
  region text not null check (region in ('us', 'eu', 'ap')),
  retention_posture text not null
    check (retention_posture in ('zero_retention', 'provider_default', 'unverified')),
  primary key (consent_id, provider, region)
);

create table model_provider_credentials (
  tenant_id text references tenants(tenant_id),
  provider text not null,
  encrypted_credential bytea not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check (octet_length(encrypted_credential) > 0)
);

create unique index model_provider_credentials_scope_idx on model_provider_credentials
  (tenant_id, provider) nulls not distinct;

create table model_resolution_events (
  resolution_id text primary key,
  tenant_id text not null references tenants(tenant_id),
  module_id text not null,
  use_case text not null,
  provider text not null,
  model text not null,
  key_origin text not null check (key_origin in ('tenant', 'installation', 'none')),
  region_served text not null check (region_served in ('us', 'eu', 'ap')),
  retention_posture text not null
    check (retention_posture in ('zero_retention', 'provider_default', 'unverified')),
  allowlist_version text not null references model_allowlist_versions(allowlist_version),
  resolved_at timestamptz not null default now()
);

comment on table model_resolution_events is
  'Append-only attribution for model resolution; never stores prompt, completion, or credential material.';
