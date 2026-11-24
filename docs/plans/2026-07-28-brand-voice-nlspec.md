# NLSpec: brand document upload and voice profile

Source: `docs/product/brand-and-voice-documents.md`, accepted 2026-07-28.
Scope: build steps 1 to 4. No model call anywhere.

Satisfaction target: 0.85

## Purpose

Seed brand configuration from an uploaded `brand.md` through the existing
reviewed proposal pipeline, and store a structured voice profile. Three things
must become true that are not true today: the pipeline accepts file provenance
(today it rejects anything without an HTTPS `sourceUrl`, in TypeScript and in a
CHECK constraint); it gains an apply step (it has never had one, per `0013`'s
header comment); and a tenant-private voice profile exists as validated stored
data wired to no generation surface.

## Actors

- **Tenant admin** — uploads, reviews, edits, applies, supersedes. Bound to
  exactly one tenant.
- **Installation owner** — sets `locked_keys`. Gains no upload right over a
  tenant.
- **Managed-support actor** — reads a proposal. Refused upload, apply,
  supersede, revoke.
- **Parser** — deterministic versioned code, no model in the path.

## Behaviors

### B1. Upload provenance
`ProposedBrandValue` provenance becomes a discriminated union. The HTTPS variant
is unchanged. New variant: `{ kind: "upload", fileDigest, uploadedByUserId,
uploadedAt }`. `fileDigest` is SHA-256 over raw uploaded bytes, not normalised
text.

### B2. Provenance constraint migration
Migration `0020` alters `brand_proposal_values_are_provenanced` to accept both
shapes and nothing else. An upload mints a synthetic `brand_seed_requests` row,
so `request_id` stays `not null` and `brand_proposals_one_per_request` holds.

### B3. Parse brand.md
Deterministic extraction of keys already in `BrandTokenKey`, from fenced
key/value blocks and a recognised heading set. Every value type-validated
against its key. Maximum file size 256 KiB. Maximum 64 extracted keys.

### B4. Apply a reviewed proposal
Writes the `overrides` layer of `brand_policies`, increments `version` by
exactly 1, updates `updated_at`, appends exactly one `audit_events` row with
actor, reason and policy version.

### B5. Lock rejection
A value targeting a key in `locked_keys` is rejected per key with a reason,
surfaced before confirmation. Unlocked keys in the same proposal still apply.

### B6. Supersede
A new upload moves an existing `draft` to a new `superseded` status. An applied
proposal is never superseded, edited or discarded. Identical digest re-upload is
a no-op.

### B7. Voice profile storage
Tenant-private versioned record, closed vocabularies only: reading level,
formality, person, tense, sentence length, banned words, preferred words, and at
most 20 example rewrites. No free-text field. Maximum 200 words per list.

### B8. Voice profile validation
Banned and preferred lists canonicalised (case fold, Unicode NFC) before
comparison; a word in both is refused at save time. An example rewrite
containing a URL, credential or imperative instruction is refused at save time.

## Constraints

- Zero model calls in this scope: no prompt assembly, no adapter, no
  `ModelRouter` usage.
- Exactly one writer to `brand_policies`: the apply step. No second write path.
- An upload is never given a synthetic `sourceUrl` to satisfy the HTTPS check.
- Zero model-authored brand values; parser output only.
- Control-plane storage. Any tenant-data-plane table must join
  `tooling/ci/rls-proof.mjs`, enforced by `rls-inventory.test.mjs`.
- Migrations execute against real PostgreSQL in the `migration-execution` CI
  job. Assert constraint behaviour by writing rows the constraint must refuse.
  Substring assertions against SQL text are prohibited: that is how `0018`
  shipped invalid and passed 20 assertions.
- Parser versions immutable, recorded per proposal. A parser change never
  rewrites an existing proposal.
- Upload, review, edit, apply, supersede, revoke are 6 distinct permissions,
  each bound to an exact tenant.
- Synthetic identifiers only. No `.env` access, no external provisioning, no
  Vercel CLI, no secrets in output.

## Dependencies

- `packages/platform-core/src/brand-proposal.ts` — create/review/discard today.
- `resolve-brand.ts`, `branding.ts` — cascade, `BrandTokenKey`, locks.
- `control-plane/0001_init.sql`, `0005`, `0013`. Next number is `0020`.
- `integration-guard.ts`, the `migration-execution` CI job.
- Node 22, pnpm, turbo, vitest 3, pg 8.

## Acceptance

Preconditions: a tenant row exists, a `brand_policies` row exists for it, the
actor is a tenant admin bound to that tenant.

Postconditions after apply: `overrides` contains the applied keys, `version`
incremented by exactly 1, exactly 1 new `audit_events` row, proposal in a
terminal applied state.

1. `createBrandProposal` accepts upload provenance and still rejects a value
   with neither kind.
2. An upload is never stored with a `sourceUrl`.
3. Concurrent apply of one proposal: exactly 1 succeeds, 1 version bump, 1 audit
   row; the other fails on conflict.
4. Apply fails rather than clobbering when `version` moved since review.
5. A proposal with 1 locked and 2 unlocked keys applies 2 and reports 1 with a
   reason.
6. A duplicate key, conflicting heading, or 1 malformed value is rejected per
   key, never silently partially applied.
7. A file parsing to 0 recognised keys errors and lists the headings found.
8. Identical-digest re-upload creates 0 new proposals.
9. An applied proposal cannot be superseded, edited or discarded.
10. A managed-support actor is refused upload, apply, supersede, revoke.
11. A word in both word lists is refused, including when differing only by case
    or Unicode form.
12. An example rewrite containing a URL or imperative instruction is refused.
13. Migration `0020` executes against real PostgreSQL in CI, and every new
    constraint has a test writing a row it must refuse.
14. `pnpm turbo typecheck lint test` passes.

Edge cases and error handling: concurrent apply; version drift between review
and apply; identical-digest re-upload; zero-key parse; partially malformed file;
locked-key collision; word lists contradicting only after Unicode
normalisation; actor bound to a different tenant; apply against an already
applied proposal.
