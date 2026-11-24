-- The record name is durable; the random TXT value remains hash-only.
alter table domains add column challenge_record text;
update domains set challenge_record = '_opentenant-challenge.' || host where kind = 'custom';
alter table domains add constraint domain_challenge_record_bound check (
  challenge_record is null or (kind = 'custom' and challenge_record = '_opentenant-challenge.' || host)
);
