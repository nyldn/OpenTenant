-- R3 / E03. Reserved in docs/plans/migration-reservations.md.
-- Queue identities contain opaque directory references, never email addresses.
create table support.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  ticket_id uuid not null,
  ticket_number text not null,
  ticket_version bigint not null,
  event text not null check (event in ('created', 'reply')),
  subject_id text not null,
  destination_ref text not null check (
    destination_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    and destination_ref !~* '(^https?:|@)'
  ),
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'retry', 'sending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  total_attempts integer not null default 0 check (total_attempts >= attempts),
  manual_retries integer not null default 0 check (manual_retries >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  safe_error text check (safe_error in ('transient', 'permanent', 'destination_unavailable')),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ticket_id, ticket_version, subject_id),
  foreign key (tenant_id, ticket_id, ticket_version)
    references support.outbox_events (tenant_id, ticket_id, ticket_version),
  foreign key (tenant_id, subject_id, channel)
    references support.delivery_preferences (tenant_id, subject_id, channel),
  channel text not null default 'email' check (channel = 'email'),
  check ((status = 'sending') = (lease_token is not null and lease_until is not null)),
  check ((status = 'delivered') = (delivered_at is not null)),
  check ((status in ('retry', 'failed')) = (safe_error is not null))
);
create index email_deliveries_due on support.email_deliveries (tenant_id, next_attempt_at)
  where status in ('pending', 'retry', 'sending');

create table support.email_delivery_events (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  delivery_id uuid not null,
  actor jsonb not null,
  action text not null check (action in ('delivered', 'retry', 'failed', 'manual_retry')),
  attempt integer not null,
  safe_error text check (safe_error in ('transient', 'permanent', 'destination_unavailable')),
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, delivery_id) references support.email_deliveries (tenant_id, id)
);
create trigger email_delivery_events_append_only
  before update or delete on support.email_delivery_events
  for each row execute function support.block_support_depth_mutation();
create trigger email_delivery_events_no_truncate
  before truncate on support.email_delivery_events
  execute function support.block_support_depth_mutation();

create function support.guard_email_delivery() returns trigger language plpgsql as $$
begin
  if (new.id, new.tenant_id, new.ticket_id, new.ticket_number, new.ticket_version,
      new.event, new.subject_id, new.destination_ref, new.idempotency_key, new.channel, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.ticket_id, old.ticket_number, old.ticket_version,
      old.event, old.subject_id, old.destination_ref, old.idempotency_key, old.channel, old.created_at)
     or old.status = 'delivered'
     or new.total_attempts < old.total_attempts
     or new.manual_retries < old.manual_retries then
    raise exception 'email delivery identity and completion are immutable';
  end if;
  return new;
end;
$$;
create trigger email_delivery_guard before update on support.email_deliveries
  for each row execute function support.guard_email_delivery();

-- This trigger is intentionally in the ticket/outbox transaction. A delivery
-- insert failure rolls back the ticket or reply as well. No historic backfill.
create function support.enqueue_ticket_email() returns trigger language plpgsql as $$
begin
  if new.kind in ('created', 'reply') then
    insert into support.email_deliveries
      (tenant_id, ticket_id, ticket_number, ticket_version, event,
       subject_id, destination_ref, idempotency_key)
    select new.tenant_id, new.ticket_id, new.ticket_number, new.ticket_version,
           new.kind, p.subject_id, p.destination_ref,
           new.tenant_id || '/' || new.ticket_id || '/' || new.ticket_version || '/email/' || p.subject_id
      from support.tickets t join support.delivery_preferences p
        on p.tenant_id = t.tenant_id and p.subject_id = t.created_by
       and p.channel = 'email' and p.enabled
     where t.tenant_id = new.tenant_id and t.id = new.ticket_id;
  end if;
  return new;
end;
$$;
create trigger ticket_outbox_enqueue_email after insert on support.outbox_events
  for each row execute function support.enqueue_ticket_email();

alter table support.email_deliveries enable row level security;
alter table support.email_deliveries force row level security;
create policy email_deliveries_isolation on support.email_deliveries
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table support.email_delivery_events enable row level security;
alter table support.email_delivery_events force row level security;
create policy email_delivery_events_isolation on support.email_delivery_events
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on support.email_deliveries to tenant_app;
grant select, insert on support.email_delivery_events to tenant_app;
revoke delete, truncate on support.email_deliveries from tenant_app;
revoke update, delete, truncate on support.email_delivery_events from tenant_app;
grant usage, select on sequence support.email_delivery_events_id_seq to tenant_app;
