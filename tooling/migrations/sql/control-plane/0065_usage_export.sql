-- Export state is separate from immutable usage evidence. No ledger mutations.
create table usage_export_cursors (
  sink_id text primary key check (sink_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  last_event_id text references exact_usage_events (event_id),
  exported_count bigint not null default 0 check (exported_count >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

-- A timestamp high-water mark cannot see a late-committing writer. Receipts
-- make the durable cursor a set of acknowledged entries, independent of time.
create table usage_export_receipts (
  sink_id text not null references usage_export_cursors (sink_id),
  event_id text not null references exact_usage_events (event_id),
  exported_at timestamptz not null default clock_timestamp(),
  primary key (sink_id, event_id)
);
create index usage_export_scan on exact_usage_events (recorded_at, event_id);
