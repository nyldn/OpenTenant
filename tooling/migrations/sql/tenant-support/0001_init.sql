-- Tenant-local support schema (WP-B), ported from the engage help-desk
-- design onto the platform's fail-closed RLS pattern. One Neon project per
-- tenant; RLS is defense in depth. User references are internal platform
-- UserIds (text) with no local FK: identity lives provider-side.

create schema support;

comment on schema support is 'WP-B support module: tickets, thread, events';

create table support.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_number text not null,
  created_by text not null,
  assigned_to text,
  subject text not null check (char_length(subject) between 1 and 200),
  description text not null check (char_length(description) between 1 and 5000),
  category text not null default 'other'
    check (category in ('bug_report', 'feature_request', 'how_to', 'account_issue', 'billing', 'other')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'awaiting_reply', 'resolved', 'closed')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  -- AI triage lands in a later pass; the columns exist so early tickets
  -- backfill cleanly.
  ai_category text,
  ai_category_confidence numeric(3,2),
  ai_priority text,
  ai_deflected boolean not null default false,
  ai_diagnostic_summary text,
  escalated boolean not null default false,
  escalated_at timestamptz,
  escalated_by text,
  page_context jsonb not null default '{}',
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  csat_rating smallint check (csat_rating between 1 and 5),
  csat_comment text,
  csat_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ticket_number)
);

create index tickets_tenant_status_idx on support.tickets (tenant_id, status, created_at desc);
create index tickets_assigned_idx on support.tickets (tenant_id, assigned_to, status);

-- Per-tenant atomic ticket numbering (SUP-000001). No SECURITY DEFINER:
-- the database is single-tenant and RLS covers the upsert.
create table support.ticket_sequences (
  tenant_id text primary key references tenant_core.tenant_meta (tenant_id),
  last_number integer not null default 0
);

create table support.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null references support.tickets (id) on delete cascade,
  author_id text not null,
  body text not null check (char_length(body) between 1 and 10000),
  message_type text not null default 'reply'
    check (message_type in ('reply', 'internal_note', 'ai_response', 'system')),
  created_at timestamptz not null default now()
);

create index messages_ticket_idx on support.messages (tenant_id, ticket_id, created_at asc);

-- Append-only per-ticket event trail. Written in the same transaction as
-- the mutation it records, so a change never lands unaudited (the pattern
-- proven by the support module tests). Admin-significant events additionally mirror
-- to the platform audit chain after commit.
create table support.ticket_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  ticket_id uuid not null references support.tickets (id) on delete cascade,
  actor jsonb not null,
  kind text not null
    check (kind in ('created', 'reply', 'internal_note', 'status_change', 'assignment', 'priority_change', 'escalation', 'resolution', 'csat')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index ticket_events_ticket_idx on support.ticket_events (tenant_id, ticket_id, created_at asc);

create table support.canned_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  category text,
  usage_count integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  title text not null check (char_length(title) between 1 and 200),
  content text not null,
  category text not null,
  tags text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  source_ticket_id uuid references support.tickets (id) on delete set null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_articles_status_idx on support.knowledge_articles (tenant_id, status, category);

create table support.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  user_id text not null,
  ticket_id uuid not null references support.tickets (id) on delete cascade,
  kind text not null
    check (kind in ('ticket_created', 'ticket_assigned', 'ticket_escalated', 'new_reply', 'ticket_resolved', 'ticket_reopened', 'sla_warning', 'csat_request')),
  title text not null,
  body text,
  read_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on support.notifications (tenant_id, user_id, read_at nulls first, created_at desc);

-- Ticket events are append-only at the database level.
create function support.block_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ticket_events is append-only';
end;
$$;

create trigger ticket_events_no_update_delete
  before update or delete on support.ticket_events
  for each row execute function support.block_event_mutation();

alter table support.tickets enable row level security;
alter table support.tickets force row level security;
create policy tickets_isolation on support.tickets
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.ticket_sequences enable row level security;
alter table support.ticket_sequences force row level security;
create policy ticket_sequences_isolation on support.ticket_sequences
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.messages enable row level security;
alter table support.messages force row level security;
create policy messages_isolation on support.messages
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.ticket_events enable row level security;
alter table support.ticket_events force row level security;
create policy ticket_events_isolation on support.ticket_events
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.canned_responses enable row level security;
alter table support.canned_responses force row level security;
create policy canned_responses_isolation on support.canned_responses
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.knowledge_articles enable row level security;
alter table support.knowledge_articles force row level security;
create policy knowledge_articles_isolation on support.knowledge_articles
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.notifications enable row level security;
alter table support.notifications force row level security;
create policy notifications_isolation on support.notifications
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant usage on schema support to tenant_app;
grant select, insert, update, delete on all tables in schema support to tenant_app;
grant usage, select on all sequences in schema support to tenant_app;
alter default privileges in schema support grant select, insert, update, delete on tables to tenant_app;
alter default privileges in schema support grant usage, select on sequences to tenant_app;
revoke update, delete on support.ticket_events from tenant_app;
revoke delete on support.tickets from tenant_app;
revoke update, delete on support.messages from tenant_app;

-- The migration runner connects as the project owner (BYPASSRLS on Neon).
insert into tenant_core.module_schema_versions (tenant_id, module_key, version)
select tenant_id, 'support', '0001_init'
  from tenant_core.tenant_meta
on conflict (tenant_id, module_key) do update set
  version = excluded.version,
  applied_at = now();
