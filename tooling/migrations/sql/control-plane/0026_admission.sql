create table admission_policies (
  tenant_id text not null references tenants (tenant_id) check (length(tenant_id) between 1 and 128),
  scope_key text not null check (length(scope_key) between 1 and 512),
  principal_id text not null check (length(principal_id) between 1 and 128),
  operation text not null check (length(operation) between 1 and 128),
  max_requests integer not null check (max_requests > 0),
  window_ms bigint not null check (window_ms > 0),
  max_concurrent integer not null check (max_concurrent > 0),
  lease_ms bigint not null check (lease_ms > 0),
  idempotency_ttl_ms bigint not null check (idempotency_ttl_ms >= lease_ms),
  max_idempotency_entries integer not null check (max_idempotency_entries > 0),
  max_size_bytes bigint not null check (max_size_bytes >= 0),
  primary key (tenant_id, scope_key)
);

create table admission_windows (
  tenant_id text not null check (length(tenant_id) between 1 and 128),
  scope_key text not null,
  window_started_at timestamptz not null,
  admitted_count integer not null check (admitted_count >= 0),
  limit_count integer not null check (limit_count > 0 and admitted_count <= limit_count),
  primary key (tenant_id, scope_key, window_started_at),
  foreign key (tenant_id, scope_key) references admission_policies (tenant_id, scope_key)
);

create table admission_leases (
  tenant_id text not null check (length(tenant_id) between 1 and 128),
  scope_key text not null,
  lease_id text not null check (lease_id ~ '^[0-9a-f]{32}$'),
  principal_id text not null check (length(principal_id) between 1 and 128),
  operation text not null check (length(operation) between 1 and 128),
  admitted_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > admitted_at),
  retained_until timestamptz not null check (retained_until >= expires_at),
  status text not null check (status in ('active', 'released', 'expired')),
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object'),
  primary key (tenant_id, scope_key, lease_id),
  foreign key (tenant_id, scope_key) references admission_policies (tenant_id, scope_key)
);

create index admission_leases_active_idx on admission_leases (tenant_id, scope_key, expires_at)
  where status = 'active';

create table admission_idempotency_records (
  tenant_id text not null check (length(tenant_id) between 1 and 128),
  scope_key text not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  fingerprint text not null check (length(fingerprint) between 1 and 128),
  lease_id text not null,
  retained_until timestamptz not null,
  primary key (tenant_id, scope_key, idempotency_key),
  foreign key (tenant_id, scope_key, lease_id)
    references admission_leases (tenant_id, scope_key, lease_id)
);

create index admission_idempotency_expiry_idx
  on admission_idempotency_records (tenant_id, scope_key, retained_until);
