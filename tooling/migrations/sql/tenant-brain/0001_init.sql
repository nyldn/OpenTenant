-- Tenant-local brain schema. One Neon project exists per tenant, so
-- declarative partitioning adds complexity without reducing cardinality.
-- RLS remains mandatory as fail-closed defense in depth.

create extension if not exists vector;

create schema brain;

comment on schema brain is 'ADR-004 brain ingestion and MCP scaffold';

create table brain.entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  kind text not null,
  canonical_name text not null,
  summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, canonical_name)
);

create table brain.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  entity_id uuid not null references brain.entities (id) on delete cascade,
  alias text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, alias)
);

create table brain.raw_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  source text not null,
  source_id text not null,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  visibility text not null check (visibility in ('private', 'internal', 'shared')),
  content_hash text not null,
  provenance jsonb not null default '{}',
  redacted_at timestamptz,
  unique (tenant_id, source, source_id)
);

create table brain.raw_signal_payloads (
  raw_signal_id uuid primary key references brain.raw_signals (id) on delete cascade,
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  content_type text not null,
  payload_text text not null,
  stored_at timestamptz not null default now(),
  unique (tenant_id, raw_signal_id)
);

create table brain.raw_signal_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  raw_signal_id uuid not null references brain.raw_signal_payloads (raw_signal_id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  token_count integer not null check (token_count > 0),
  content text not null,
  embedding vector(1536),
  embedding_dimensions integer not null default 1536 check (embedding_dimensions > 0),
  embedding_provider text,
  embedding_model text,
  created_at timestamptz not null default now(),
  unique (tenant_id, raw_signal_id, chunk_index)
);

create table brain.validated_context (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  entity_id uuid not null references brain.entities (id) on delete cascade,
  statement text not null,
  rationale text,
  trust_tier text not null check (trust_tier in ('candidate', 'validated', 'superseded')),
  source_chunk_id uuid references brain.raw_signal_chunks (id) on delete set null,
  validated_by jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brain.context_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  src_entity_id uuid not null references brain.entities (id) on delete cascade,
  dst_entity_id uuid not null references brain.entities (id) on delete cascade,
  relation text not null,
  claim text not null,
  confidence numeric(5,4),
  source_chunk_id uuid references brain.raw_signal_chunks (id) on delete set null,
  extraction_model text not null,
  trust_tier text not null default 'extracted' check (trust_tier = 'extracted'),
  created_at timestamptz not null default now()
);

comment on table brain.context_edges is 'Traversal stays in query code via recursive CTE; schema stores extracted edge facts only.';

create table brain.decisions_log (
  id bigserial primary key,
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  sequence bigint not null,
  occurred_at timestamptz not null,
  actor jsonb not null,
  subject text not null,
  decision text not null,
  rationale text not null,
  outcome text,
  detail jsonb not null default '{}',
  previous_hash text not null,
  hash text not null,
  unique (tenant_id, sequence)
);

create table brain.quarantine (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  source text not null,
  source_id text,
  reason text not null,
  payload_ciphertext text not null,
  aad text not null check (aad = 'quarantine:' || tenant_id),
  created_at timestamptz not null default now()
);

create function brain.block_append_only_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create function brain.block_payload_update() returns trigger
language plpgsql as $$
begin
  raise exception 'raw_signal_payloads is update-forbidden; delete for redaction instead';
end;
$$;

create trigger raw_signals_no_update_delete
  before update or delete on brain.raw_signals
  for each row execute function brain.block_append_only_mutation();

create trigger decisions_log_no_update_delete
  before update or delete on brain.decisions_log
  for each row execute function brain.block_append_only_mutation();

create trigger raw_signal_payloads_no_update
  before update on brain.raw_signal_payloads
  for each row execute function brain.block_payload_update();

create index entities_kind_name_idx on brain.entities (tenant_id, kind, canonical_name);
create index entity_aliases_entity_idx on brain.entity_aliases (tenant_id, entity_id);
create index raw_signals_source_idx on brain.raw_signals (tenant_id, source, source_id);
create index raw_signals_redacted_idx on brain.raw_signals (tenant_id, redacted_at);
create index raw_signal_chunks_signal_idx on brain.raw_signal_chunks (tenant_id, raw_signal_id, chunk_index);
create index raw_signal_chunks_embedding_hnsw_idx
  on brain.raw_signal_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index validated_context_entity_idx on brain.validated_context (tenant_id, entity_id, trust_tier);
create index context_edges_src_idx on brain.context_edges (tenant_id, src_entity_id, relation);
create index context_edges_dst_idx on brain.context_edges (tenant_id, dst_entity_id, relation);
create index decisions_log_occurred_at_idx on brain.decisions_log (tenant_id, occurred_at desc);
create index quarantine_created_at_idx on brain.quarantine (tenant_id, created_at desc);

alter table brain.entities enable row level security;
alter table brain.entities force row level security;
create policy entities_isolation on brain.entities
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.entity_aliases enable row level security;
alter table brain.entity_aliases force row level security;
create policy entity_aliases_isolation on brain.entity_aliases
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.raw_signals enable row level security;
alter table brain.raw_signals force row level security;
create policy raw_signals_isolation on brain.raw_signals
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.raw_signal_payloads enable row level security;
alter table brain.raw_signal_payloads force row level security;
create policy raw_signal_payloads_isolation on brain.raw_signal_payloads
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.raw_signal_chunks enable row level security;
alter table brain.raw_signal_chunks force row level security;
create policy raw_signal_chunks_isolation on brain.raw_signal_chunks
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.validated_context enable row level security;
alter table brain.validated_context force row level security;
create policy validated_context_isolation on brain.validated_context
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.context_edges enable row level security;
alter table brain.context_edges force row level security;
create policy context_edges_isolation on brain.context_edges
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.decisions_log enable row level security;
alter table brain.decisions_log force row level security;
create policy decisions_log_isolation on brain.decisions_log
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table brain.quarantine enable row level security;
alter table brain.quarantine force row level security;
create policy quarantine_isolation on brain.quarantine
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant usage on schema brain to tenant_app;
grant select, insert, update, delete on all tables in schema brain to tenant_app;
grant usage, select on all sequences in schema brain to tenant_app;
alter default privileges in schema brain grant select, insert, update, delete on tables to tenant_app;
alter default privileges in schema brain grant usage, select on sequences to tenant_app;
revoke update, delete on brain.raw_signals from tenant_app;
revoke update, delete on brain.decisions_log from tenant_app;
revoke update on brain.raw_signal_payloads from tenant_app;

-- The migration runner connects as the project owner, which on Neon carries
-- BYPASSRLS; a nobypassrls role could not read tenant_meta here and this
-- insert would silently no-op.
insert into tenant_core.module_schema_versions (tenant_id, module_key, version)
select tenant_id, 'brain', '0001_init'
  from tenant_core.tenant_meta
on conflict (tenant_id, module_key) do update set
  version = excluded.version,
  applied_at = now();
