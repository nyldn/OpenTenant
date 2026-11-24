-- One-time consumption for OAuth consent states (RFC 9700 replay defense).
-- The callback inserts the state's hash before exchanging the code; a
-- duplicate insert means replay and the callback rejects.

create table oauth_consumed_states (
  state_hash text primary key,
  tenant_id text not null,
  consumed_at timestamptz not null default now()
);

comment on table oauth_consumed_states is 'Replay guard: each signed OAuth state completes at most one callback.';
