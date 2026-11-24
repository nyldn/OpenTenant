# Plan: immutable tenant voice-profile storage

Date: 2026-07-30
Backlog: `BRAND-VOICE-04`

## Scope

Store validated, versioned, tenant-private voice profiles in the control plane.
This slice creates no authentication or UI surface and imports no model router,
prompt builder, provider adapter, or generation code. Seeded voice proposals,
consent wording, inference watermarks, and generation conditioning remain later
work.

The direct acceptance requirement wins over the broader deletion wording in
the PRD: published profile versions remain immutable and revocation never
destroys a version that later evidence may reference. Event-driven deletion in
section 7 applies to uploaded or derived artifacts, not these immutable profile
versions.

## Validation contract

- Return the complete normalized profile, including its closed-vocabulary
  fields.
- Normalize words to Unicode NFC and lowercase before duplicate and overlap
  comparison.
- Accept only bounded word tokens made from Unicode letters and marks with
  internal apostrophes or hyphens. Reject control/format characters, URLs,
  credentials, email addresses, phone numbers, social handles, imperative
  instructions, and contact-solicitation patterns in both word lists and
  example rewrites.
- Enforce the 200-word list limit, 20-rewrite limit, per-word length limit, and
  separate before/after length limits.
- Reject duplicates and banned/preferred contradictions after canonicalization
  instead of silently resolving them.

## Storage contract

Migration `0024` creates:

1. `tenant_voice_profiles`, a mutable head/projection keyed by `tenant_id`,
   carrying `current_version`, monotonic `next_version`, an optimistic
   `revision`, and `updated_at`;
2. `tenant_voice_profile_versions`, immutable append-only versions keyed by
   `(tenant_id, version)`, with the validated structured profile, canonical
   SHA-256 digest, publishing human, reason, and timestamp; and
3. `tenant_voice_profile_revocations`, immutable append-only revocation
   evidence keyed by `(tenant_id, version)`, with revoking human, reason, and
   timestamp.

Composite foreign keys prevent a head or revocation from referencing another
tenant's version. Database validation enforces the closed enums, exact profile
shape, canonical bounded word lists, duplicate/overlap denial, rewrite shape
and limits, and digest shape even when application validation is bypassed.
Triggers reject update, delete, and truncate of versions or revocations; reject
head deletion/truncation; require every head transition to increment `revision`
exactly once; require publication to consume the prior `next_version`; and
prevent a head from selecting a revoked version.

## Transaction contract

`PgTenantVoiceProfileStore` requires a user actor, bounded reason, and explicit
`expectedRevision` on every mutation. There is no blind or optional compare.

Publish inserts the empty head with `on conflict do nothing`, locks the head,
checks `expectedRevision`, validates and canonicalizes the profile, rejects an
unchanged current digest, inserts `next_version`, advances the head and
revision, and appends one `brand.voice_profile.published` audit event in the
same transaction. The persistent `next_version` allocates monotonically after
revocation.

Revoke locks the same head first, checks both `expectedRevision` and the exact
current version, inserts revocation evidence, clears the current pointer,
increments the revision, and appends one `brand.voice_profile.revoked` event in
the same transaction. Head lock always precedes the audit-chain advisory lock.

Reads return a tenant-scoped head snapshot and immutable history with revocation
evidence. Wrong-tenant publication, reads, and revocation fail closed.

## Test and delivery contract

- Observe RED in focused platform-core and store tests before production code.
- Put the real PostgreSQL store proof in
  `tooling/migrations/src/control-plane-voice-profile.integration.test.ts`,
  because the migration-execution CI job supplies PostgreSQL only to that
  package. The suite may import the store implementation by repository-relative
  path so it exercises the real composition boundary.
- Execute direct database writes that must fail for invalid structure,
  non-canonical or contradictory lists, cross-tenant references, immutable
  evidence mutation/deletion/truncation, illegal head transitions, and
  revocation of a non-current version.
- Use two real connections to prove two publishers with the same revision
  produce exactly one success, one immutable version, one head advance, and one
  canonical audit event.
- Prove publication, second-version allocation, tenant-scoped reads,
  stale-revision rejection, revocation, retained history, and audit atomicity.
- Update `CHANGELOG.md`, `docs/HANDOFF.md`, `docs/SHIPLOG.md`, the backlog
  status, and Graphify output. Run focused tests, the declared forced monorepo
  matrix, real PostgreSQL verification, `git diff --check`, and
  `graphify check-update .`.

Marketing classification: `truth`.
