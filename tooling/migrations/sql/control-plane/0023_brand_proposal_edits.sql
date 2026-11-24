-- A reviewed proposal's values are the evidence a human approved. Changing
-- those values is allowed only as one review-invalidating transition.
create function enforce_brand_proposal_review_invalidation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- Migration 0020 owns the applied-row terminal error and delete semantics.
  -- Let its later trigger fire so callers retain the established contract.
  if old.status = 'applied' then
    return new;
  end if;

  -- A proposal may change the parsed value, but never what value keys existed
  -- or the evidence attached to them. Removing "value" from every entry leaves
  -- exactly the immutable key/provenance envelope for comparison.
  if old.proposed_values <> '{}'::jsonb
    and (
    select coalesce(pg_catalog.jsonb_object_agg(item.key, item.value - 'value'), '{}'::jsonb)
      from pg_catalog.jsonb_each(new.proposed_values) as item
    ) is distinct from (
    select coalesce(pg_catalog.jsonb_object_agg(item.key, item.value - 'value'), '{}'::jsonb)
      from pg_catalog.jsonb_each(old.proposed_values) as item
    )
  then
    raise exception 'brand proposal value keys and provenance are immutable';
  end if;

  if old.status in ('discarded', 'superseded')
    and new.proposed_values is distinct from old.proposed_values
  then
    raise exception 'a terminal brand proposal cannot be edited';
  end if;

  if old.status = 'reviewed'
    and new.status = 'draft'
    and new.proposed_values is not distinct from old.proposed_values
  then
    raise exception 'invalidating brand proposal review requires changed values';
  end if;

  if old.status = 'reviewed'
    and new.proposed_values is distinct from old.proposed_values
    and not (
      new.status = 'draft'
      and new.reviewed_at is null
      and new.reviewed_policy_version is null
    )
  then
    raise exception 'editing reviewed brand proposal values must invalidate review';
  end if;

  if new.status = 'reviewed'
    and new.proposed_values is distinct from old.proposed_values
  then
    raise exception 'reviewing a brand proposal cannot also edit its values';
  end if;

  return new;
end;
$$;

create trigger brand_proposals_enforce_review_invalidation
  before update on brand_proposals
  for each row execute function enforce_brand_proposal_review_invalidation();
