-- OPS-09: canonical tenant-bound delivery, attachment, SLA, and CSAT state.
-- Destination/object references are opaque; no provider address, URL, secret,
-- attachment bytes, or cross-tenant analytics row is stored here.

alter table support.tickets
  add constraint tickets_tenant_id_id_unique unique (tenant_id, id);

create table support.delivery_preferences (
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  subject_id text not null check (subject_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  channel text not null check (channel in ('in_app', 'email')),
  enabled boolean not null,
  destination_ref text not null
    check (
      destination_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      and destination_ref !~* '(^https?:|@)'
    ),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, subject_id, channel)
);

create table support.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null,
  ticket_version bigint not null check (ticket_version >= 1),
  channel text not null check (channel in ('in_app', 'email')),
  event text not null check (event in ('created', 'reply', 'assigned', 'resolved', 'csat_request')),
  destination_ref text not null
    check (
      destination_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      and destination_ref !~* '(^https?:|@)'
    ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 500),
  status text not null check (status in ('delivered', 'failed')),
  safe_error_class text
    check (safe_error_class in ('transient', 'permanent', 'destination_unavailable')),
  retry_of uuid,
  root_attempt_id uuid not null,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id),
  foreign key (tenant_id, ticket_id, ticket_version) references support.outbox_events (tenant_id, ticket_id, ticket_version),
  foreign key (tenant_id, retry_of) references support.delivery_attempts (tenant_id, id),
  foreign key (tenant_id, root_attempt_id) references support.delivery_attempts (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, retry_of),
  check (
    (status = 'delivered' and safe_error_class is null)
    or (status = 'failed' and safe_error_class is not null)
  ),
  check (
    (attempt_number = 1 and retry_of is null and root_attempt_id = id)
    or (attempt_number > 1 and retry_of is not null)
  )
);

create function support.validate_delivery_attempt() returns trigger
language plpgsql as $$
declare
  parent_root_attempt_id uuid;
  parent_attempt_number smallint;
begin
  if new.attempt_number = 1 then
    return new;
  end if;
  select root_attempt_id, attempt_number
    into parent_root_attempt_id, parent_attempt_number
    from support.delivery_attempts
   where tenant_id = new.tenant_id and id = new.retry_of;
  if not found
     or new.root_attempt_id is distinct from parent_root_attempt_id
     or new.attempt_number <> parent_attempt_number + 1 then
    raise exception 'invalid delivery retry chain';
  end if;
  return new;
end;
$$;

create trigger delivery_attempts_validate
  before insert on support.delivery_attempts
  for each row execute function support.validate_delivery_attempt();

create table support.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null,
  uploaded_by text not null,
  file_name text not null
    check (
      char_length(file_name) between 1 and 120
      and file_name !~ '[\x00-\x1f/\\]'
      and file_name not in ('.', '..')
    ),
  media_type text not null
    check (media_type in ('text/plain', 'text/csv', 'application/pdf', 'image/png', 'image/jpeg')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  object_ref text not null
    check (
      object_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      and object_ref !~* '(^https?:|\.\.)'
    ),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id),
  unique (tenant_id, object_ref)
);

create table support.sla_policies (
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  first_response_minutes integer not null check (first_response_minutes >= 1),
  resolution_minutes integer not null check (resolution_minutes >= first_response_minutes),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, priority)
);

-- The active clock is canonical tenant state. Paused time accumulates across
-- transitions so awaiting-customer intervals never count after a resume.
create table support.sla_states (
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null,
  state text not null check (state in ('running', 'paused', 'stopped')),
  accumulated_paused_minutes numeric(12,3) not null default 0
    check (accumulated_paused_minutes >= 0),
  paused_at timestamptz,
  last_transition_at timestamptz not null,
  primary key (tenant_id, ticket_id),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id),
  check (
    (state = 'paused' and paused_at is not null)
    or (state in ('running', 'stopped') and paused_at is null)
  )
);

create function support.guard_sla_state_update() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.ticket_id is distinct from old.ticket_id
     or new.accumulated_paused_minutes < old.accumulated_paused_minutes
     or new.last_transition_at < old.last_transition_at then
    raise exception 'invalid SLA state transition';
  end if;
  return new;
end;
$$;

create trigger sla_states_guard_update
  before update on support.sla_states
  for each row execute function support.guard_sla_state_update();

-- One immutable response per canonical ticket. Free-text comments remain in
-- the tenant plane and are never selected into operational analytics.
create table support.csat_responses (
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null,
  requester_id text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  submitted_at timestamptz not null default now(),
  primary key (tenant_id, ticket_id),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id)
);

-- Content-free canonical evidence for every support-depth command/read. Ticket
-- content, CSAT comments, filenames, destination refs, and object refs are
-- deliberately absent and structurally denied from detail.
create table support.depth_events (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  actor_id text not null,
  action text not null check (action ~ '^support\.[a-z_]+\.[a-z_]+$'),
  subject_ref text not null check (char_length(subject_ref) between 1 and 128),
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  constraint depth_events_content_free check (
    not (detail ?| array[
      'subject', 'body', 'description', 'message', 'comment', 'file_name',
      'destination_ref', 'object_ref', 'email', 'url'
    ])
  )
);

create function support.block_support_depth_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger delivery_attempts_no_update_delete
  before update or delete on support.delivery_attempts
  for each row execute function support.block_support_depth_mutation();
create trigger attachments_no_update_delete
  before update or delete on support.attachments
  for each row execute function support.block_support_depth_mutation();
create trigger csat_responses_no_update_delete
  before update or delete on support.csat_responses
  for each row execute function support.block_support_depth_mutation();
create trigger depth_events_no_update_delete
  before update or delete on support.depth_events
  for each row execute function support.block_support_depth_mutation();

alter table support.delivery_preferences enable row level security;
alter table support.delivery_preferences force row level security;
create policy delivery_preferences_isolation on support.delivery_preferences
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.delivery_attempts enable row level security;
alter table support.delivery_attempts force row level security;
create policy delivery_attempts_isolation on support.delivery_attempts
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.attachments enable row level security;
alter table support.attachments force row level security;
create policy attachments_isolation on support.attachments
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.sla_policies enable row level security;
alter table support.sla_policies force row level security;
create policy sla_policies_isolation on support.sla_policies
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.sla_states enable row level security;
alter table support.sla_states force row level security;
create policy sla_states_isolation on support.sla_states
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.csat_responses enable row level security;
alter table support.csat_responses force row level security;
create policy csat_responses_isolation on support.csat_responses
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.depth_events enable row level security;
alter table support.depth_events force row level security;
create policy depth_events_isolation on support.depth_events
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

revoke update, delete on support.delivery_attempts from tenant_app;
revoke update, delete on support.attachments from tenant_app;
revoke update, delete on support.csat_responses from tenant_app;
revoke update, delete on support.depth_events from tenant_app;

insert into tenant_core.module_schema_versions (tenant_id, module_key, version)
select tenant_id, 'support', '0004_support_depth'
  from tenant_core.tenant_meta
on conflict (tenant_id, module_key) do update set
  version = excluded.version,
  applied_at = now();
