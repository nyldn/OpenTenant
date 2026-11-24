-- These two tables are append-only evidence, including on an empty schema.
create trigger decisions_log_no_truncate before truncate on brain.decisions_log
  for each statement execute function brain.block_append_only_mutation();
create trigger raw_signals_no_truncate before truncate on brain.raw_signals
  for each statement execute function brain.block_append_only_mutation();
