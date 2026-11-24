-- Adapted from rate-limiter-flexible (ISC), Copyright 2019 Roman Voloboev.
-- Source commit and full permission notice: THIRD_PARTY_NOTICES.md.
-- rate-limiter-flexible's documented Postgres store contract. Apply before enabling routes.
-- Keys contain hashes only. No request, tenant, user or IP content is persisted.
CREATE TABLE IF NOT EXISTS request_rate_limits (
  key varchar(255) PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  expire bigint
);
CREATE INDEX IF NOT EXISTS request_rate_limits_expire_idx ON request_rate_limits (expire);
