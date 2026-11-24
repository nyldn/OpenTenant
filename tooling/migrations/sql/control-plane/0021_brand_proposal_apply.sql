-- Pin the brand policy version a human reviewed. Apply compares this value
-- with the locked policy row so a later manual edit is never overwritten.
alter table brand_proposals
  add column reviewed_policy_version integer;

update brand_proposals proposal
   set reviewed_policy_version = policy.version
  from brand_policies policy
 where proposal.tenant_id = policy.tenant_id
   and proposal.status = 'reviewed';

alter table brand_proposals
  drop constraint brand_proposals_status_timestamps;

alter table brand_proposals
  add constraint brand_proposals_status_timestamps check (
    (status = 'draft'
      and reviewed_at is null and reviewed_policy_version is null
      and discarded_at is null and superseded_at is null and applied_at is null)
    or (status = 'reviewed'
      and reviewed_at is not null
      and reviewed_policy_version is not null and reviewed_policy_version >= 1
      and discarded_at is null and superseded_at is null and applied_at is null)
    or (status = 'discarded' and discarded_at is not null and applied_at is null)
    or (status = 'superseded'
      and superseded_at is not null and reviewed_at is null
      and reviewed_policy_version is null
      and discarded_at is null and applied_at is null)
    or (status = 'applied'
      and applied_at is not null and applied_by is not null
      and reviewed_at is not null
      and reviewed_policy_version is not null and reviewed_policy_version >= 1
      and discarded_at is null and superseded_at is null)
  );

comment on column brand_proposals.reviewed_policy_version is
  'Optimistic brand_policies version pinned when the proposal enters reviewed state';
