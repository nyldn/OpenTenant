-- R2 is reserved in docs/plans/migration-reservations.md. Provider-neutral,
-- tenant-bound desired state is authoritative even during provider outages.
create table authorization_sync_streams (
  tenant_id text primary key references tenants (tenant_id) on delete cascade,
  next_sequence bigint not null default 0
);
create table authorization_sync_state (
  tenant_id text not null references tenants (tenant_id) on delete cascade,
  kind text not null check (kind in ('membership', 'entitlement')),
  subject text not null,
  version uuid not null,
  delivered_version uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (tenant_id, kind, subject)
);
create table authorization_outbox (
  tenant_id text not null references tenants (tenant_id) on delete cascade,
  sequence bigint not null,
  kind text not null check (kind in ('membership', 'entitlement')),
  subject text not null,
  version uuid not null,
  previous_version uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  last_error text check (last_error is null or last_error = 'authorization_sync_failed'),
  primary key (tenant_id, sequence),
  unique (tenant_id, kind, subject, version),
  foreign key (tenant_id, kind, subject) references authorization_sync_state (tenant_id, kind, subject),
  check ((lease_token is null) = (lease_until is null))
);
create index authorization_outbox_pending on authorization_outbox (tenant_id, sequence) where completed_at is null;
comment on table authorization_sync_state is 'Only acknowledged immutable versions may authorize. Never use an old tuple namespace while desired state is pending.';
