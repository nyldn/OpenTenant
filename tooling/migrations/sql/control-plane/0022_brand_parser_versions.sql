create table brand_parser_versions (
  parser_version text primary key
    check (parser_version ~ '^[a-z][a-z0-9-]{2,63}$'),
  created_at timestamptz not null default now()
);

insert into brand_parser_versions (parser_version)
values ('brand-md-v1');

create function reject_brand_parser_version_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'brand parser versions cannot be deleted';
  end if;
  raise exception 'brand parser versions are immutable';
end;
$$;

create trigger brand_parser_versions_insert_only
  before update or delete on brand_parser_versions
  for each row execute function reject_brand_parser_version_mutation();

create trigger brand_parser_versions_no_truncate
  before truncate on brand_parser_versions
  for each statement execute function reject_brand_parser_version_mutation();

alter table brand_proposals
  add column parser_version text;

-- Before installing the stricter write trigger, fail the upgrade if an older
-- row claims provenance that disagrees with its immutable request source.
do $migration$
begin
  if exists (
    select 1
      from public.brand_proposals proposal
      join public.brand_seed_requests request
        on request.request_id = proposal.request_id
       and request.tenant_id = proposal.tenant_id
      cross join lateral pg_catalog.jsonb_each(proposal.proposed_values)
        as proposed(key, value)
     where (
       request.origin = 'upload'
       and (
         not (proposed.value ? 'fileDigest')
         or request.source_url <> 'upload:' || (proposed.value ->> 'fileDigest')
       )
     ) or (
       request.origin = 'https'
       and not (proposed.value ? 'sourceUrl')
     )
  ) then
    raise exception 'existing brand proposal provenance does not match its request origin';
  end if;
end;
$migration$;

-- Applied proposals are otherwise terminal for every update. Temporarily
-- suspend that one trigger inside this migration transaction so historical
-- upload proposals can receive the parser that produced them.
alter table brand_proposals
  disable trigger brand_proposals_enforce_terminal_apply;

update brand_proposals proposal
   set parser_version = 'brand-md-v1'
  from brand_seed_requests request
 where request.request_id = proposal.request_id
   and request.tenant_id = proposal.tenant_id
   and request.origin = 'upload';

alter table brand_proposals
  enable trigger brand_proposals_enforce_terminal_apply;

alter table brand_proposals
  add constraint brand_proposals_parser_version_fk
  foreign key (parser_version)
  references brand_parser_versions (parser_version);

create function enforce_brand_proposal_parser_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  request_origin text;
  request_source_url text;
begin
  if tg_op = 'UPDATE' and new.parser_version is distinct from old.parser_version then
    raise exception 'brand proposal parser version is immutable';
  end if;

  select origin, source_url
    into request_origin, request_source_url
    from public.brand_seed_requests
   where request_id = new.request_id
     and tenant_id = new.tenant_id
     for key share;

  if request_origin is null then
    raise exception 'brand proposals require a known request origin';
  elsif request_origin = 'upload' and new.parser_version is null then
    raise exception 'upload proposals require a parser version';
  elsif request_origin <> 'upload' and new.parser_version is not null then
    raise exception 'non-upload proposals require no parser version';
  end if;
  if request_origin = 'upload' and exists (
    select 1
      from jsonb_each(new.proposed_values) as proposed(key, value)
     where proposed.value ? 'sourceUrl'
       and not (proposed.value ? 'fileDigest')
  ) then
    raise exception 'brand proposal values must match the upload request origin';
  elsif request_origin = 'upload' and exists (
    select 1
     from jsonb_each(new.proposed_values) as proposed(key, value)
     where proposed.value ? 'fileDigest'
       and (proposed.value ->> 'fileDigest') ~ '^[0-9a-f]{64}$'
       and request_source_url <> 'upload:' || (proposed.value ->> 'fileDigest')
  ) then
    raise exception 'brand proposal value digest must match its upload request';
  elsif request_origin = 'https' and exists (
    select 1
      from jsonb_each(new.proposed_values) as proposed(key, value)
     where proposed.value ? 'fileDigest'
       and not (proposed.value ? 'sourceUrl')
  ) then
    raise exception 'brand proposal values must match the HTTPS request origin';
  end if;
  return new;
end;
$$;

create trigger brand_proposals_parser_version_immutable
  before insert or update on brand_proposals
  for each row execute function enforce_brand_proposal_parser_version();

create function enforce_brand_seed_request_source_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.origin is distinct from old.origin
    or new.source_url is distinct from old.source_url
  then
    raise exception 'brand seed request source is immutable';
  end if;
  return new;
end;
$$;

create trigger brand_seed_requests_source_immutable
  before update on brand_seed_requests
  for each row execute function enforce_brand_seed_request_source_immutable();

create function reject_brand_provenance_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'brand proposal provenance cannot be truncated';
end;
$$;

create trigger brand_proposals_no_truncate
  before truncate on brand_proposals
  for each statement execute function reject_brand_provenance_truncate();

create trigger brand_seed_requests_no_truncate
  before truncate on brand_seed_requests
  for each statement execute function reject_brand_provenance_truncate();

comment on table brand_parser_versions is
  'Insert-only registry of deterministic brand document parser implementations';
comment on column brand_proposals.parser_version is
  'Immutable parser used for an upload proposal; null for non-upload proposals';
