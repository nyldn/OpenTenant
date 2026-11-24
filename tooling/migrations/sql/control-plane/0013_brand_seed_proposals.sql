-- Website seeding is asynchronous and never activates tenant branding.
-- Requests contain no fetched claims; proposals contain value-level provenance
-- and remain review/discard records until a separate apply operation exists.
create function brand_proposal_values_are_provenanced(candidate_values jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  proposed jsonb;
  retrieved_at text;
begin
  if jsonb_typeof(candidate_values) <> 'object' then return false; end if;
  for proposed in select value from jsonb_each(candidate_values) loop
    if jsonb_typeof(proposed) <> 'object'
      or not (proposed ? 'value')
      or jsonb_typeof(proposed -> 'sourceUrl') is distinct from 'string'
      or length(proposed ->> 'sourceUrl') not between 1 and 2048
      or (proposed ->> 'sourceUrl') !~ '^https://([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:[/?#]|$)'
      or jsonb_typeof(proposed -> 'retrievedAt') is distinct from 'string'
      or (proposed ->> 'retrievedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
    then
      return false;
    end if;
    retrieved_at := proposed ->> 'retrievedAt';
    begin
      perform retrieved_at::timestamptz;
    exception when others then
      return false;
    end;
  end loop;
  return true;
end;
$$;

create table brand_seed_requests (
  request_id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants (tenant_id),
  source_url text not null check (
    length(source_url) between 1 and 2048
    and source_url ~ '^https://([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:[/?#]|$)'
  ),
  status text not null default 'pending' check (status in ('pending', 'running', 'failed', 'completed', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, tenant_id)
);

create unique index brand_seed_requests_one_open_source
  on brand_seed_requests (tenant_id, source_url)
  where status <> 'discarded';

create table brand_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  tenant_id text not null references tenants (tenant_id),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'discarded')),
  proposed_values jsonb not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  discarded_at timestamptz,
  constraint brand_proposals_request_tenant_fk
    foreign key (request_id, tenant_id) references brand_seed_requests (request_id, tenant_id),
  constraint brand_proposals_one_per_request unique (request_id),
  constraint brand_proposals_values_provenanced check (brand_proposal_values_are_provenanced(proposed_values)),
  constraint brand_proposals_status_timestamps check (
    (status = 'draft' and reviewed_at is null and discarded_at is null)
    or (status = 'reviewed' and reviewed_at is not null and discarded_at is null)
    or (status = 'discarded' and discarded_at is not null)
  ),
  constraint brand_proposals_timestamp_order check (
    (reviewed_at is null or reviewed_at >= created_at)
    and (discarded_at is null or discarded_at >= coalesce(reviewed_at, created_at))
  )
);

comment on table brand_seed_requests is 'Optional hostile-site retrieval request; never active branding';
comment on table brand_proposals is 'Reviewable inactive brand values with per-value sourceUrl and retrievedAt provenance';
