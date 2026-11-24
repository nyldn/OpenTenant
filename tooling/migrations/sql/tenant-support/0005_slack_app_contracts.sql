-- OPS-10: provider-independent Slack app references and action receipts.
-- Provider credential custody, OAuth exchange, and network delivery are
-- intentionally outside this tenant-plane contract.

create table support.slack_app_connections (
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  installation_id text not null check (installation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  tenant_id text not null references tenant_core.tenant_meta (tenant_id),
  workspace_ref text not null check (workspace_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (installation_id, tenant_id, id),
  unique (installation_id, tenant_id, workspace_ref)
);

create table support.slack_app_channels (
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  installation_id text not null,
  tenant_id text not null,
  connection_id text not null,
  channel_ref text not null check (channel_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (installation_id, tenant_id, id),
  unique (installation_id, tenant_id, connection_id, id),
  unique (installation_id, tenant_id, connection_id, channel_ref),
  foreign key (installation_id, tenant_id, connection_id)
    references support.slack_app_connections (installation_id, tenant_id, id)
);

create table support.slack_ticket_threads (
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  installation_id text not null,
  tenant_id text not null,
  connection_id text not null,
  channel_id text not null,
  thread_ref text not null check (thread_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  ticket_id uuid not null,
  ticket_version bigint not null check (ticket_version >= 1),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (installation_id, tenant_id, id),
  unique (installation_id, tenant_id, connection_id, id),
  unique (installation_id, tenant_id, connection_id, channel_id, thread_ref),
  foreign key (installation_id, tenant_id, connection_id)
    references support.slack_app_connections (installation_id, tenant_id, id),
  foreign key (installation_id, tenant_id, connection_id, channel_id)
    references support.slack_app_channels (installation_id, tenant_id, connection_id, id),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id)
);

create table support.slack_identity_mappings (
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  installation_id text not null,
  tenant_id text not null,
  connection_id text not null,
  provider_user_ref text not null check (provider_user_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  actor_id text not null check (actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (installation_id, tenant_id, id),
  unique (installation_id, tenant_id, connection_id, provider_user_ref),
  foreign key (installation_id, tenant_id, connection_id)
    references support.slack_app_connections (installation_id, tenant_id, id)
);

create table support.slack_action_receipts (
  action_id text not null check (action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  installation_id text not null,
  tenant_id text not null,
  connection_id text not null,
  channel_id text not null,
  thread_id text not null,
  identity_mapping_id text not null,
  ticket_id uuid not null,
  expected_ticket_version bigint not null check (expected_ticket_version >= 1),
  action text not null check (action in ('acknowledge', 'assign_self', 'resolve')),
  actor_id text not null,
  processed_at timestamptz not null default now(),
  primary key (tenant_id, action_id),
  unique (installation_id, tenant_id, action_id),
  foreign key (installation_id, tenant_id, connection_id)
    references support.slack_app_connections (installation_id, tenant_id, id),
  foreign key (installation_id, tenant_id, connection_id, channel_id)
    references support.slack_app_channels (installation_id, tenant_id, connection_id, id),
  foreign key (installation_id, tenant_id, connection_id, thread_id)
    references support.slack_ticket_threads (installation_id, tenant_id, connection_id, id),
  foreign key (installation_id, tenant_id, identity_mapping_id)
    references support.slack_identity_mappings (installation_id, tenant_id, id),
  foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id)
);

create function support.block_slack_action_receipt_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'slack action receipts are append-only';
end;
$$;

create trigger slack_action_receipts_no_update_delete
  before update or delete on support.slack_action_receipts
  for each row execute function support.block_slack_action_receipt_mutation();

alter table support.slack_app_connections enable row level security;
alter table support.slack_app_connections force row level security;
create policy slack_app_connections_isolation on support.slack_app_connections
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.slack_app_channels enable row level security;
alter table support.slack_app_channels force row level security;
create policy slack_app_channels_isolation on support.slack_app_channels
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.slack_ticket_threads enable row level security;
alter table support.slack_ticket_threads force row level security;
create policy slack_ticket_threads_isolation on support.slack_ticket_threads
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.slack_identity_mappings enable row level security;
alter table support.slack_identity_mappings force row level security;
create policy slack_identity_mappings_isolation on support.slack_identity_mappings
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

alter table support.slack_action_receipts enable row level security;
alter table support.slack_action_receipts force row level security;
create policy slack_action_receipts_isolation on support.slack_action_receipts
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

revoke update, delete on support.slack_action_receipts from tenant_app;

insert into tenant_core.module_schema_versions (tenant_id, module_key, version)
select tenant_id, 'support', '0005_slack_app_contracts'
  from tenant_core.tenant_meta
on conflict (tenant_id, module_key) do update set
  version = excluded.version,
  applied_at = now();
