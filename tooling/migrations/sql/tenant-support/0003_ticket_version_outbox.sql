-- OPS-06: canonical ticket versions and the transactional support outbox.
-- Every ticket mutation bumps the canonical version and appends one outbox
-- row in the same tenant transaction. Downstream consumers (the owner
-- helpdesk projection, notification adapters) read the outbox; the outbox
-- and every projection derived from it are never ticket authority.

alter table support.tickets
  add column version bigint not null default 1 check (version >= 1);

-- The canonical version can only hold or advance by exactly one per update.
create function support.tickets_guard_version() returns trigger language plpgsql as $$
begin
  if new.version is distinct from old.version
     and new.version <> old.version + 1 then
    raise exception 'tickets.version must advance by exactly one';
  end if;
  return new;
end;
$$;

create trigger tickets_guard_version
  before update on support.tickets
  for each row execute function support.tickets_guard_version();

create table support.outbox_events (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null references support.tickets (id),
  ticket_number text not null,
  ticket_version bigint not null check (ticket_version >= 1),
  kind text not null check (kind in (
    'created', 'reply', 'internal_note', 'status_change', 'assignment',
    'priority_change', 'escalation', 'resolution', 'csat', 'tombstone'
  )),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  -- Consumer idempotency key: one event per canonical ticket version.
  unique (tenant_id, ticket_id, ticket_version),
  -- The envelope carries queue metadata only: never subjects, bodies,
  -- messages, or attachment content.
  constraint outbox_payload_content_free check (
    not (payload ?| array[
      'subject', 'body', 'description', 'message', 'messages', 'attachment',
      'attachments'
    ])
  )
);

comment on table support.outbox_events is
  'Transactional outbox for ticket queue metadata; append-only identity, '
  'delivery-state columns move, and content fields are structurally denied';

create index support_outbox_pending_idx
  on support.outbox_events (tenant_id, id)
  where status = 'pending';

-- Identity, ordering, and payload are append-only; only delivery state
-- (status, attempts, claimed_at, delivered_at, last_error) may change, and a
-- terminal status cannot silently reopen.
create function support.outbox_guard_update() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.ticket_id is distinct from old.ticket_id
     or new.ticket_number is distinct from old.ticket_number
     or new.ticket_version is distinct from old.ticket_version
     or new.kind is distinct from old.kind
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at then
    raise exception 'outbox_events identity and payload are append-only';
  end if;
  if old.status in ('delivered', 'dead')
     and new.status is distinct from old.status then
    raise exception 'outbox_events terminal status is immutable';
  end if;
  return new;
end;
$$;

create trigger outbox_events_guard_update
  before update on support.outbox_events
  for each row execute function support.outbox_guard_update();

alter table support.outbox_events enable row level security;
alter table support.outbox_events force row level security;
create policy outbox_events_isolation on support.outbox_events
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

-- 0001's default privileges already grant CRUD on new tables; retention
-- deletion stays with the migration/runner owner role.
revoke delete on support.outbox_events from tenant_app;

-- The migration runner connects as the project owner (BYPASSRLS on Neon).
insert into tenant_core.module_schema_versions (tenant_id, module_key, version)
select tenant_id, 'support', '0003_ticket_version_outbox'
  from tenant_core.tenant_meta
on conflict (tenant_id, module_key) do update set
  version = excluded.version,
  applied_at = now();
