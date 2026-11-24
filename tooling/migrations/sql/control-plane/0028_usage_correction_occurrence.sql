create or replace function enforce_usage_correction_scope() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare original exact_usage_events%rowtype;
begin
  if new.correction_of_event_id is null then return new; end if;
  select * into original from exact_usage_events where event_id = new.correction_of_event_id;
  if not found or original.tenant_id <> new.tenant_id or original.metric_id <> new.metric_id
    or original.occurred_at <> new.occurred_at
    or original.correction_of_event_id is not null then
    raise exception 'invalid usage correction target' using errcode = '23514';
  end if;
  return new;
end $$;
