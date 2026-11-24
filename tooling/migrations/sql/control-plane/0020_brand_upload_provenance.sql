-- Uploaded brand documents enter the reviewed proposal pipeline, and the
-- pipeline finally gains the apply step it has never had.
--
-- 0013's header says it plainly: proposals "remain review/discard records until
-- a separate apply operation exists." That operation is here. Until now the
-- seeding pipeline could produce a reviewed proposal and had no way to make it
-- take effect, so URL seeding was as unfinished as upload.
--
-- The provenance constraint accepted exactly one shape, an HTTPS URL with a
-- retrieval timestamp, in the database and in TypeScript. A file has no URL.
-- The tempting shortcut is to mint a fake sourceUrl for uploads, which would
-- put a fabricated claim inside the one pipeline whose entire purpose is
-- provenance. Instead the constraint learns a second shape and refuses
-- everything else, including a row carrying both.

-- 1. Two provenance shapes, exclusively.

create or replace function brand_proposal_values_are_provenanced(candidate_values jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  proposed jsonb;
  stamp text;
  is_https boolean;
  is_upload boolean;
begin
  if jsonb_typeof(candidate_values) <> 'object' then return false; end if;

  for proposed in select value from jsonb_each(candidate_values) loop
    if jsonb_typeof(proposed) <> 'object' or not (proposed ? 'value') then
      return false;
    end if;

    is_https := proposed ? 'sourceUrl' or proposed ? 'retrievedAt';
    is_upload := proposed ? 'fileDigest'
      or proposed ? 'uploadedByUserId'
      or proposed ? 'uploadedAt';

    -- Exactly one shape. A value carrying fields from both is not a value with
    -- richer provenance, it is a value whose origin cannot be stated.
    if is_https = is_upload then
      return false;
    end if;

    if is_https then
      if jsonb_typeof(proposed -> 'sourceUrl') is distinct from 'string'
        or length(proposed ->> 'sourceUrl') not between 1 and 2048
        or (proposed ->> 'sourceUrl') !~ '^https://([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:[/?#]|$)'
        or jsonb_typeof(proposed -> 'retrievedAt') is distinct from 'string'
        or (proposed ->> 'retrievedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
      then
        return false;
      end if;
      stamp := proposed ->> 'retrievedAt';
    else
      -- SHA-256 over the raw uploaded bytes. Fixed length and lower-case hex,
      -- so a digest computed over normalised text or truncated for display
      -- cannot pass as the real one.
      if jsonb_typeof(proposed -> 'fileDigest') is distinct from 'string'
        or (proposed ->> 'fileDigest') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(proposed -> 'uploadedByUserId') is distinct from 'string'
        or length(btrim(proposed ->> 'uploadedByUserId')) = 0
        or length(proposed ->> 'uploadedByUserId') > 255
        or jsonb_typeof(proposed -> 'uploadedAt') is distinct from 'string'
        or (proposed ->> 'uploadedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
      then
        return false;
      end if;
      stamp := proposed ->> 'uploadedAt';
    end if;

    begin
      perform stamp::timestamptz;
    exception when others then
      return false;
    end;
  end loop;

  return true;
end;
$$;

-- 2. An upload is a seed request too.
--
-- brand_proposals.request_id is not null and foreign-keyed to
-- brand_seed_requests, whose source_url must be an HTTPS URL. Rather than make
-- request_id nullable and lose the guarantee that every proposal has an
-- origin row, uploads mint a request whose origin is the file digest. The
-- source_url check becomes a discriminated one: HTTPS for a fetch, an
-- upload:<digest> URI for a file.

alter table brand_seed_requests
  add column origin text not null default 'https'
    check (origin in ('https', 'upload'));

alter table brand_seed_requests
  drop constraint brand_seed_requests_source_url_check;

alter table brand_seed_requests
  add constraint brand_seed_requests_source_url_check check (
    (origin = 'https'
      and length(source_url) between 1 and 2048
      and source_url ~ '^https://([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:[/?#]|$)')
    or (origin = 'upload' and source_url ~ '^upload:[0-9a-f]{64}$')
  );

-- brand_seed_requests_one_open_source already keys on (tenant_id, source_url)
-- where status <> 'discarded'. For an upload that key is the file digest, so
-- re-uploading identical bytes collides with the open request rather than
-- creating a second proposal. That is the "identical digest re-upload is a
-- no-op" rule, enforced by the index that was already there.

-- 3. Superseded and applied.

alter table brand_proposals
  add column superseded_at timestamptz,
  add column applied_at timestamptz,
  add column applied_by text;

alter table brand_proposals drop constraint brand_proposals_status_timestamps;
alter table brand_proposals drop constraint brand_proposals_timestamp_order;

-- 0013 declared the status check inline on the column, so PostgreSQL named it
-- brand_proposals_status_check. It still restricts status to the original three
-- values, so it has to go before superseded and applied can ever be stored, and
-- its auto-generated name is one an ADD CONSTRAINT would collide with. The
-- replacement is named explicitly.
alter table brand_proposals drop constraint brand_proposals_status_check;

alter table brand_proposals
  add constraint brand_proposals_status_allowed
    check (status in ('draft', 'reviewed', 'discarded', 'superseded', 'applied'));

alter table brand_proposals
  add constraint brand_proposals_status_timestamps check (
    (status = 'draft'
      and reviewed_at is null and discarded_at is null
      and superseded_at is null and applied_at is null)
    or (status = 'reviewed'
      and reviewed_at is not null and discarded_at is null
      and superseded_at is null and applied_at is null)
    or (status = 'discarded' and discarded_at is not null and applied_at is null)
    -- Only a draft is ever superseded. A reviewed proposal a human has read,
    -- and an applied one that is already in force, are not replaced by the
    -- arrival of a newer file.
    or (status = 'superseded'
      and superseded_at is not null and reviewed_at is null
      and discarded_at is null and applied_at is null)
    or (status = 'applied'
      and applied_at is not null and applied_by is not null
      and reviewed_at is not null
      and discarded_at is null and superseded_at is null)
  );

alter table brand_proposals
  add constraint brand_proposals_timestamp_order check (
    (reviewed_at is null or reviewed_at >= created_at)
    and (superseded_at is null or superseded_at >= created_at)
    and (discarded_at is null or discarded_at >= coalesce(reviewed_at, created_at))
    and (applied_at is null or applied_at >= reviewed_at)
  );

-- 4. Applied is terminal.
--
-- Without this, a proposal already written into brand_policies could be moved
-- back to draft, edited, and applied again, and the audit row would describe a
-- proposal whose contents no longer match what was applied.

create function enforce_brand_proposal_terminal_apply() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'applied' then
      raise exception 'an applied brand proposal cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'applied' then
    raise exception 'an applied brand proposal is terminal and cannot be edited, superseded or discarded';
  end if;
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'a superseded brand proposal cannot be revived';
  end if;
  if old.status = 'discarded' and new.status <> 'discarded' then
    raise exception 'a discarded brand proposal cannot be revived';
  end if;
  -- Provenance is the record of where a value came from. Editing it after the
  -- fact is the one change that makes the whole pipeline meaningless.
  if old.tenant_id is distinct from new.tenant_id
    or old.request_id is distinct from new.request_id
  then
    raise exception 'brand proposal identity is immutable';
  end if;

  return new;
end;
$$;

create trigger brand_proposals_enforce_terminal_apply
  before update or delete on brand_proposals
  for each row execute function enforce_brand_proposal_terminal_apply();

-- 5. One live draft per tenant.
--
-- Supersession only means something if there is at most one draft to supersede.

create unique index brand_proposals_one_live_draft
  on brand_proposals (tenant_id)
  where status = 'draft';

comment on column brand_proposals.applied_by is
  'Actor who applied the proposal to brand_policies; paired with an audit_events row';
comment on column brand_seed_requests.origin is
  'https for a fetched site, upload for a brand.md; source_url carries upload:<sha256> for the latter';
