-- Forward-only hardening. Database owners can still disable triggers; signed
-- checkpoints must also be retained outside this database.
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function audit_events_block_mutation();

create table audit_checkpoints (
  note_hash text primary key check (note_hash ~ '^[a-f0-9]{64}$'),
  origin text not null,
  sequence bigint not null check (sequence >= 0),
  head_hash text not null check (head_hash ~ '^[a-f0-9]{64}$'),
  key_id text not null,
  signed_note text not null,
  anchored_at timestamptz not null default now()
);
comment on table audit_checkpoints is 'Signed external checkpoint receipts; never the verifier trust root';
create index audit_checkpoints_origin_sequence_idx on audit_checkpoints (origin, sequence desc);
create function audit_checkpoints_block_mutation() returns trigger
language plpgsql as $$ begin raise exception 'audit_checkpoints is append-only'; end; $$;
create trigger audit_checkpoints_no_update_delete before update or delete on audit_checkpoints
  for each row execute function audit_checkpoints_block_mutation();
create trigger audit_checkpoints_no_truncate before truncate on audit_checkpoints
  for each statement execute function audit_checkpoints_block_mutation();

-- Model routing and stream terminal records are also audit evidence.
create trigger model_resolution_events_no_truncate before truncate on model_resolution_events
  for each statement execute function enforce_model_resolution_event_immutability();
create trigger model_stream_terminal_events_no_truncate before truncate on model_stream_terminal_events
  for each statement execute function enforce_model_resolution_event_immutability();
