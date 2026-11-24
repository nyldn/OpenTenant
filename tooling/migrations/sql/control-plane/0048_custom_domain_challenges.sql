-- Plaintext DNS challenges are returned once to the administrator, never stored.
alter table domains
  add column challenge_hash text check (challenge_hash ~ '^[a-f0-9]{64}$'),
  add column challenge_expires_at timestamptz,
  add column verified_at timestamptz,
  add column verification_valid_until timestamptz,
  add column next_check_at timestamptz;

-- Legacy custom domains have no ownership evidence; require a fresh challenge.
update domains set active = false, verification = 'pending' where kind = 'custom';

alter table domains add constraint custom_domain_evidence_required check (
  kind <> 'custom' or not active or
  (challenge_hash is not null and verified_at is not null and verification_valid_until is not null)
);
create index domains_reverification_due_idx on domains (next_check_at) where kind = 'custom';
