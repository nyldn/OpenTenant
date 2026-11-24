create table usage_metric_definitions (
  tenant_id text not null references tenants (tenant_id),
  metric_id text not null check (metric_id ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(metric_id) <= 64),
  unit text not null check (length(unit) between 1 and 64),
  description text not null check (length(description) between 1 and 256),
  registered_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, metric_id)
);

create table exact_usage_events (
  event_id text primary key check (event_id ~ '^[0-9a-f]{32}$'),
  tenant_id text not null,
  metric_id text not null,
  quantity bigint not null check (quantity <> 0 and quantity between -9007199254740991 and 9007199254740991),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  source_reference text not null check (length(source_reference) between 1 and 128),
  fingerprint text not null check (length(fingerprint) between 1 and 128),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 1 and 128),
  correction_of_event_id text references exact_usage_events (event_id),
  correction_reason text check (correction_reason is null or length(correction_reason) between 1 and 256),
  foreign key (tenant_id, metric_id) references usage_metric_definitions (tenant_id, metric_id),
  check ((correction_of_event_id is null and correction_reason is null and quantity > 0)
    or (correction_of_event_id is not null and correction_reason is not null))
);

create unique index exact_usage_events_tenant_idempotency_key
  on exact_usage_events (tenant_id, idempotency_key) where idempotency_key is not null;
create index exact_usage_events_aggregate on exact_usage_events (tenant_id, metric_id, occurred_at);

create function reject_usage_evidence_mutation() returns trigger language plpgsql set search_path = pg_catalog as $$
begin raise exception 'usage evidence is append-only' using errcode = '55000'; end $$;
create trigger usage_metric_definitions_immutable before update or delete or truncate on usage_metric_definitions
  for each statement execute function reject_usage_evidence_mutation();
create trigger exact_usage_events_immutable before update or delete or truncate on exact_usage_events
  for each statement execute function reject_usage_evidence_mutation();

create function enforce_usage_correction_scope() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare original exact_usage_events%rowtype;
begin
  if new.correction_of_event_id is null then return new; end if;
  select * into original from exact_usage_events where event_id = new.correction_of_event_id;
  if not found or original.tenant_id <> new.tenant_id or original.metric_id <> new.metric_id
    or original.correction_of_event_id is not null then
    raise exception 'invalid usage correction target' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger exact_usage_correction_scope before insert on exact_usage_events
  for each row execute function enforce_usage_correction_scope();
