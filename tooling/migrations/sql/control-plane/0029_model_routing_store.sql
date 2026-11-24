-- Add the fields the model routing API needs but migration 0018 could not
-- represent. Prompt, output, credential, and usage data remain outside model
-- evidence.

alter table model_allowlist_entries
  add column upstream_provider text,
  add column upstream_data_policy text;

-- Legacy OpenRouter rows recorded only a boolean. Keep those rows readable,
-- but require full pin details for every new or changed row.
alter table model_allowlist_entries
  add constraint model_allowlist_entries_pin_details check (
    (
      lower(btrim(provider)) = 'openrouter'
      and pinned_upstream
      and upstream_provider is not null
      and length(btrim(upstream_provider)) > 0
      and upstream_data_policy is not null
      and length(btrim(upstream_data_policy)) > 0
    )
    or (
      lower(btrim(provider)) <> 'openrouter'
      and not pinned_upstream
      and upstream_provider is null
      and upstream_data_policy is null
    )
  ) not valid;

create table model_consent_policy_versions (
  policy_version text primary key,
  published_by text not null,
  published_at timestamptz not null default now(),
  check (length(btrim(policy_version)) > 0),
  check (length(btrim(published_by)) > 0)
);

create function enforce_model_consent_policy_immutability() returns trigger
language plpgsql as $$
begin
  raise exception 'published model consent policies are append-only evidence';
end;
$$;

create trigger model_consent_policy_versions_enforce_immutability
  before update or delete on model_consent_policy_versions
  for each row execute function enforce_model_consent_policy_immutability();

alter table model_resolution_events
  add column operation_kind text not null default 'legacy_unknown'
    check (operation_kind in ('legacy_unknown', 'resolve', 'complete', 'stream'));

alter table model_resolution_events
  add constraint model_resolution_events_id_kind_unique
  unique (resolution_id, operation_kind);

create table model_stream_terminal_events (
  resolution_id text primary key,
  operation_kind text not null default 'stream' check (operation_kind = 'stream'),
  terminal_state text not null check (terminal_state in ('completed', 'failed', 'cancelled')),
  failure_code text,
  recorded_at timestamptz not null default now(),
  foreign key (resolution_id, operation_kind)
    references model_resolution_events (resolution_id, operation_kind),
  check (
    (terminal_state = 'failed' and failure_code is not null and failure_code = 'ADAPTER_ERROR')
    or (terminal_state <> 'failed' and failure_code is null)
  )
);

create trigger model_stream_terminal_events_enforce_immutability
  before update or delete on model_stream_terminal_events
  for each row execute function enforce_model_resolution_event_immutability();

comment on table model_stream_terminal_events is
  'Append-only stream outcome metadata. Content, credentials, and usage are excluded.';
