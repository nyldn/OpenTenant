-- Numbers 0030-0039 are intentionally reserved for parallel delivery waves.
create table tenant_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(tenant_id),
  kind text not null check (kind in ('provision','export','erase','owner_grant')),
  status text not null default 'pending' check (status in ('pending','running','failed','completed')),
  attempts integer not null default 0,
  actor jsonb not null,
  input jsonb not null default '{}',
  result jsonb not null default '{}',
  last_error text,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tenant_worker_one_provision on tenant_worker_jobs(tenant_id) where kind='provision';
create index tenant_worker_pending on tenant_worker_jobs(status,run_at);
