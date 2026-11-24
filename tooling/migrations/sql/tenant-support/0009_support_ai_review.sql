-- Reserved for Wave 5 R6 in docs/plans/migration-reservations.md.
-- No reply, ticket, delivery, or knowledge mutation is attached to these tables.
create table support.ai_controls (
  tenant_id text primary key references tenant_core.tenant_meta(tenant_id),
  enabled boolean not null default false,
  synthetic boolean not null default false,
  epoch integer not null default 1 check (epoch > 0),
  daily_limit integer not null default 100 check (daily_limit between 0 and 10000),
  actor_hourly_limit integer not null default 10 check (actor_hourly_limit between 0 and 100),
  retention_days integer not null default 30 check (retention_days between 1 and 90)
);
create table support.ai_suggestion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenant_core.tenant_meta(tenant_id),
  ticket_id uuid not null,
  ticket_version integer not null check (ticket_version > 0),
  actor_id text not null check (length(actor_id) between 1 and 128),
  actor_kind text not null default 'tenant_admin' check (actor_kind = 'tenant_admin'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  input_watermark text not null check (length(input_watermark) between 1 and 256),
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 32),
  voice_version integer check (voice_version > 0),
  voice_digest text check (voice_digest ~ '^[a-f0-9]{64}$'),
  control_epoch integer not null check (control_epoch > 0),
  admitted boolean not null,
  module_id text not null default 'support' check (module_id = 'support'),
  use_case text not null default 'reviewed-suggestion' check (use_case = 'reviewed-suggestion'),
  slot text not null default 'primary' check (slot = 'primary'),
  prompt_version text not null default 'support-suggestion-v1' check (prompt_version = 'support-suggestion-v1'),
  scaffold_version text not null default 'support-scaffold-v1' check (scaffold_version = 'support-scaffold-v1'),
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp(),
  execution_deadline timestamptz not null default clock_timestamp() + interval '45 seconds',
  retention_until timestamptz not null,
  check ((voice_version is null) = (voice_digest is null)),
  check (execution_deadline > created_at and execution_deadline <= created_at + interval '60 seconds'),
  check (retention_until > created_at and retention_until <= created_at + interval '90 days'),
  unique (tenant_id, id), unique (tenant_id, id, ticket_id),
  unique (tenant_id, actor_id, idempotency_key)
);
create index ai_requests_ticket on support.ai_suggestion_requests(tenant_id, ticket_id, created_at desc, id);
create index ai_requests_budget on support.ai_suggestion_requests(tenant_id, created_at) where admitted;
create table support.ai_suggestion_policy_snapshots (
  tenant_id text not null, request_id uuid not null,
  preparation_id uuid not null,
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  primary key (tenant_id, request_id), unique (tenant_id, request_id, preparation_id),
  foreign key (tenant_id, request_id) references support.ai_suggestion_requests(tenant_id,id)
);
create table support.ai_suggestion_attempts (
  tenant_id text not null, request_id uuid not null, preparation_id uuid not null,
  execution_id uuid not null, attempt jsonb not null check (jsonb_typeof(attempt) = 'object'),
  primary key (tenant_id, request_id),
  foreign key (tenant_id, request_id, preparation_id) references support.ai_suggestion_policy_snapshots(tenant_id,request_id,preparation_id)
);
create table support.ai_suggestions (
  id uuid primary key default gen_random_uuid(), tenant_id text not null, request_id uuid not null,
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object' and octet_length(artifact::text) <= 131072),
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, request_id), unique (tenant_id, request_id, id, artifact_digest), unique (tenant_id,id),
  foreign key (tenant_id, request_id) references support.ai_suggestion_requests(tenant_id,id)
);
create table support.ai_suggestion_terminals (
  tenant_id text not null, request_id uuid not null,
  kind text not null check (kind in ('review_required','abstained','unavailable','cancelled','consent_stale','provider_failure','policy_unavailable','unsupported_request','ticket_stale','audit_failure')),
  reason text check (reason in ('low_confidence','insufficient_information','disabled','budget_exhausted','rate_limited','no_knowledge','invalid_output','no_route','model_not_allowed','residency_mismatch','retention_mismatch','adapter_region_mismatch','user_cancelled','client_disconnected','policy_version_changed','consent_withdrawn','pair_no_longer_covered','prepared_policy_changed','consent_missing','adapter_unavailable','adapter_error','credential_unavailable','credential_broker_unavailable','credential_broker_failed','policy_store_unavailable','policy_unpinned','policy_mismatch','invalid_lifecycle','internal_error','ticket_state','capability_disabled','version_changed','resolution_evidence','terminal_evidence','support_evidence')),
  suggestion_id uuid, artifact_digest text,
  completed_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,request_id),
  check ((kind = 'review_required' and reason is null and suggestion_id is not null and artifact_digest is not null) or
    (kind <> 'review_required' and reason is not null and suggestion_id is null and artifact_digest is null)),
  foreign key (tenant_id,request_id) references support.ai_suggestion_requests(tenant_id,id)
);
create table support.ai_suggestion_reviews (
  id uuid primary key default gen_random_uuid(), tenant_id text not null, request_id uuid not null, suggestion_id uuid not null,
  actor_id text not null check (length(actor_id) between 1 and 128),
  decision text not null check (decision in ('reviewed','dismissed')),
  ticket_version integer not null check (ticket_version > 0), created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,suggestion_id),
  foreign key (tenant_id,request_id) references support.ai_suggestion_requests(tenant_id,id)
);
create table support.ai_suggestion_audit_events (
  id uuid primary key default gen_random_uuid(), tenant_id text not null, request_id uuid not null,
  actor_id text not null check (length(actor_id) between 1 and 128),
  action text not null check (action in ('requested','policy_resolved','provider_started','suggestion_created','terminal','reviewed','dismissed')),
  reason text, artifact_digest text check (artifact_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,request_id) references support.ai_suggestion_requests(tenant_id,id)
);
-- Establish tenant/ticket linkage without retaining content or blocking ticket purge.
create function support.ai_check_request_ticket() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from support.tickets where tenant_id=new.tenant_id and id=new.ticket_id and version=new.ticket_version) then
    raise exception 'support AI ticket mismatch' using errcode='23503';
  end if;
  return new;
end $$;
create trigger ai_request_ticket before insert on support.ai_suggestion_requests for each row execute function support.ai_check_request_ticket();
-- Explicit policies are discoverable by the exhaustive inventory proof.
alter table support.ai_controls enable row level security;
alter table support.ai_controls force row level security;
create policy ai_controls_isolation on support.ai_controls
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_controls to tenant_app;
revoke update, delete, truncate on support.ai_controls from tenant_app;
alter table support.ai_suggestion_requests enable row level security;
alter table support.ai_suggestion_requests force row level security;
create policy ai_suggestion_requests_isolation on support.ai_suggestion_requests
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_requests to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_requests from tenant_app;
alter table support.ai_suggestion_policy_snapshots enable row level security;
alter table support.ai_suggestion_policy_snapshots force row level security;
create policy ai_suggestion_policy_snapshots_isolation on support.ai_suggestion_policy_snapshots
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_policy_snapshots to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_policy_snapshots from tenant_app;
alter table support.ai_suggestion_attempts enable row level security;
alter table support.ai_suggestion_attempts force row level security;
create policy ai_suggestion_attempts_isolation on support.ai_suggestion_attempts
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_attempts to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_attempts from tenant_app;
alter table support.ai_suggestions enable row level security;
alter table support.ai_suggestions force row level security;
create policy ai_suggestions_isolation on support.ai_suggestions
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestions to tenant_app;
revoke update, delete, truncate on support.ai_suggestions from tenant_app;
alter table support.ai_suggestion_terminals enable row level security;
alter table support.ai_suggestion_terminals force row level security;
create policy ai_suggestion_terminals_isolation on support.ai_suggestion_terminals
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_terminals to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_terminals from tenant_app;
alter table support.ai_suggestion_reviews enable row level security;
alter table support.ai_suggestion_reviews force row level security;
create policy ai_suggestion_reviews_isolation on support.ai_suggestion_reviews
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_reviews to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_reviews from tenant_app;
alter table support.ai_suggestion_audit_events enable row level security;
alter table support.ai_suggestion_audit_events force row level security;
create policy ai_suggestion_audit_events_isolation on support.ai_suggestion_audit_events
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on support.ai_suggestion_audit_events to tenant_app;
revoke update, delete, truncate on support.ai_suggestion_audit_events from tenant_app;
revoke insert on support.ai_controls from tenant_app;
