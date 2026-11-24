-- Model routing history is evidence, so the database must refuse to rewrite it.
--
-- 0018 created the allowlist, consent and inference-record tables with no
-- protection against UPDATE or DELETE. Every one of them answers an audit
-- question about the past: which models an owner permitted under a given
-- allowlist version, what a tenant agreed to when they consented to
-- cross-border processing, and where a particular inference actually ran. A
-- history an operator can edit answers those questions with whatever the
-- operator prefers, which is worse than having no answer, because it reads as
-- authoritative.
--
-- The one legitimate mutation is consent withdrawal, which 0018 already models
-- as an in-place update of withdrawn_at and withdrawn_by. That update is
-- allowed and nothing else about the row is.

-- 1. Published allowlists are immutable.
--
-- model_resolution_events.allowlist_version cites the version an inference
-- resolved under. If the entries behind that version can change, the citation
-- names a set that no longer exists, and an auditor reconstructing why a model
-- was permitted reads today's allowlist while believing they read the one in
-- force at the time. Publishing a new version is the supported way to change
-- what is permitted.

create function enforce_model_allowlist_immutability() returns trigger
language plpgsql as $$
begin
  raise exception 'published model allowlists are immutable; publish a new allowlist version';
end;
$$;

create trigger model_allowlist_versions_enforce_immutability
  before update or delete on model_allowlist_versions
  for each row execute function enforce_model_allowlist_immutability();

create trigger model_allowlist_entries_enforce_immutability
  before update or delete on model_allowlist_entries
  for each row execute function enforce_model_allowlist_immutability();

-- 2. Inference records are append-only.
--
-- These are the evidence rows ADR-006 section 5 requires to be attributable.
-- Attribution that can be revised after the fact attributes nothing.

create function enforce_model_resolution_event_immutability() returns trigger
language plpgsql as $$
begin
  raise exception 'model resolution events are append-only evidence';
end;
$$;

create trigger model_resolution_events_enforce_immutability
  before update or delete on model_resolution_events
  for each row execute function enforce_model_resolution_event_immutability();

-- 3. Consent may be withdrawn and nothing else.
--
-- ADR-006 section 7: the answer is stored with who set it, when, and the pairs
-- it covers, "so a later audit can see what was agreed rather than that
-- something was". Editing actor_id, granted_at, policy_version or consent_id
-- after the fact defeats exactly that. Withdrawal is a state transition the
-- design calls for, so the trigger permits the withdrawal columns to move from
-- null to set, once, and freezes everything else.

create function enforce_model_consent_withdrawal_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cross-border consent records are append-only; withdraw instead of deleting';
  end if;

  if (
    old.consent_id,
    old.tenant_id,
    old.actor_id,
    old.granted_at,
    old.policy_version
  ) is distinct from (
    new.consent_id,
    new.tenant_id,
    new.actor_id,
    new.granted_at,
    new.policy_version
  ) then
    raise exception 'granted cross-border consent is immutable; only withdrawal may be recorded';
  end if;

  if old.withdrawn_at is not null and (
    old.withdrawn_at,
    old.withdrawn_by
  ) is distinct from (
    new.withdrawn_at,
    new.withdrawn_by
  ) then
    raise exception 'a withdrawn consent record cannot be re-withdrawn or reinstated';
  end if;

  return new;
end;
$$;

create trigger model_cross_border_consents_enforce_withdrawal_only
  before update or delete on model_cross_border_consents
  for each row execute function enforce_model_consent_withdrawal_only();

-- 4. The pairs are the substance of the consent, so they are frozen too.
--
-- A consent whose pairs can be widened later grants, retroactively, permission
-- the tenant never gave. Withdrawing and granting again is the supported way to
-- change scope, and it leaves both records in the history.

create function enforce_model_consent_pair_immutability() returns trigger
language plpgsql as $$
declare
  parent_withdrawn timestamptz;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'cross-border consent pairs are immutable; withdraw and grant again';
  end if;

  select withdrawn_at into parent_withdrawn
    from model_cross_border_consents
   where consent_id = new.consent_id;

  if parent_withdrawn is not null then
    raise exception 'cannot add a pair to a withdrawn consent record';
  end if;

  return new;
end;
$$;

create trigger model_cross_border_consent_pairs_enforce_immutability
  before insert or update or delete on model_cross_border_consent_pairs
  for each row execute function enforce_model_consent_pair_immutability();

-- 5. A consent covering nothing is not a consent.
--
-- 0018 allows a consent row to exist with no pairs. It reads in the audit trail
-- as "this tenant agreed to cross-border processing" while recording nothing
-- about what they agreed to, which is the precise failure ADR-006 section 7
-- was written against. The pairs land in a separate table, so this is a
-- constraint trigger deferred to commit: the transaction may insert the parent
-- and its pairs in either order, and is refused at commit if the pairs never
-- arrived.

create function enforce_model_consent_has_pairs() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from model_cross_border_consent_pairs where consent_id = new.consent_id
  ) then
    raise exception 'a cross-border consent record must name the pairs it covers';
  end if;
  return new;
end;
$$;

create constraint trigger model_cross_border_consents_require_pairs
  after insert on model_cross_border_consents
  deferrable initially deferred
  for each row execute function enforce_model_consent_has_pairs();

comment on function enforce_model_consent_has_pairs() is
  'ADR-006 section 7: consent records what was agreed, not that something was';
