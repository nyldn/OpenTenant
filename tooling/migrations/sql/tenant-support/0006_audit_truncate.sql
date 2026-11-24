create function support.block_audit_truncate() returns trigger
language plpgsql as $$ begin raise exception '% is append-only', tg_table_name; end; $$;
create trigger ticket_events_no_truncate before truncate on support.ticket_events
  for each statement execute function support.block_audit_truncate();
create trigger depth_events_no_truncate before truncate on support.depth_events
  for each statement execute function support.block_audit_truncate();
create trigger outbox_events_no_truncate before truncate on support.outbox_events
  for each statement execute function support.block_audit_truncate();
create trigger delivery_attempts_no_truncate before truncate on support.delivery_attempts
  for each statement execute function support.block_audit_truncate();
create trigger slack_action_receipts_no_truncate before truncate on support.slack_action_receipts
  for each statement execute function support.block_audit_truncate();
