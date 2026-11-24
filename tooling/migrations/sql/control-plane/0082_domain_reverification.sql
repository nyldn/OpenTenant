-- R1 reservation: 0082–0083. Keep scheduler reasons separate from operator notes.
alter table domains add column recheck_reason text
  check (recheck_reason in ('dns_unverified', 'dns_unavailable'));

-- Pending/reissued challenges are deliberately absent from the work inventory.
create index domains_scheduled_recheck_idx on domains (next_check_at, host)
  where kind = 'custom' and verified_at is not null
    and verification_valid_until is not null and challenge_hash is not null
    and challenge_expires_at is not null and challenge_record is not null
    and verification in ('verified', 'failed');
