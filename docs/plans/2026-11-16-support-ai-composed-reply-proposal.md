# Composed Support replies with exact voice attribution

Date: 2026-11-16. Wave 5 R6, E19. Status: proposed, acceptance required.
Marketing impact: none.

This proposal enables no runtime behavior. E17 continues to use cited whole
sentences and the frozen scaffold, with banned words enforced as absence.
Preferred words, example rewrites and style fields stay out of generation,
rendering and human-review decisions. Acceptance of this document must precede
a separately scoped implementation and a new fixture review.

## Decision requested

Accept a new containment contract, `support-composed-voice-v1`, for exact
canonical preferred-word matching. Its sanctioned-set version must be explicit
in every inference. The existing support boundary and reviewed-suggestion
composition remain authoritative until the owner accepts a replacement.

The decision changes which text a suggestion may contain. It grants no sending,
classification application, ticket mutation, knowledge publication, managed
support, release or provider authority. Every public reply still needs a human.

## Proposed text and evidence model

A candidate remains a closed list of segments. A claim segment contains an exact
whole-sentence source slice and its chunk id, immutable source digest, start and
end. A scaffold segment names a frozen scaffold id. A proposed voice segment
names one canonical preferred word from a particular applied profile version and
digest. It cannot carry free text, a sentence, a rewrite, a contact route or a
URL. A renderer supplies the matched canonical token. Spacing is deterministic.

Use the profile's current canonicalization, trim, en-GB lower-case and NFC, then
compare exact Unicode strings on whole-token boundaries. Do not stem, infer
inflections, use synonyms, remove accents, apply fuzzy matching or use NFKC.
`delight` does not authorize `delighted`; `resume` does not authorize `résumé`.
A fixture that canonically matches a token proves attribution only.

A voice token cannot replace, interrupt or delete any part of a cited sentence.
The first proposed grammar permits it only in a separately disclosed voice
segment outside claims. This is intentionally restrictive. If that grammar does
not produce useful replies, reject or redesign the proposal; do not relax claim
equality or add an unreviewed paraphrase allowance. Existing scaffold-only
refusal remains. At least one cited whole-sentence claim is required.

Before persistence, reject the whole artifact for an unknown field or segment,
a missing source, an out-of-range or partial-sentence span, altered claim text,
an unknown scaffold id, an unlicensed voice token, a rendered-text mismatch,
a profile digest mismatch or a banned token anywhere in the final reply. A ban
inside a source sentence causes abstention. Do not edit the sentence to pass.
URLs and contact routes must come from a cited source, with no voice or scaffold
exception. Full profiles, examples and style fields never cross the model port.

Pin the request's ticket version and watermark, template version, scaffold
version, sanctioned-set version, immutable voice version and digest, knowledge
chunk versions and spans, recorded model preparation and execution ids, routing
policy, processing basis, consent reference, artifact digest and human decision.
Evidence and its tenant audit commit atomically. Prompt and raw completion
payloads remain outside normal suggestion tables. Rejected output requires the
owner-only quarantine with a maximum 24-hour TTL. Content follows the tenant
support-retention limit and ticket purge. Content-free evidence survives.

## Residual risks and review

Exact matching proves where words came from. It cannot prove that selecting and
ordering accurate sentences answers this ticket or preserves their implication.
A licensed preferred word can also turn a neutral arrangement into a misleading
promise. Humans review the entire reply and source context, including omitted
qualifications. A successful mechanical check never labels a reply factually
certified.

The deterministic fixtures pair attacks and benign controls in preferred-word
recombination, meaning-bearing deletion and citation-boundary selection. Some
recombination and selection attacks pass current containment by construction.
Their expected result is `human_audit`, not a new hard CI failure or a model
judge. Keep those in the reported, sampled human-audit stratum. Preserve the
accepted golden-set minimums and paired regression method. These fixtures are
synthetic and make no model-quality or production claim.

Before activation, run the accepted contract/red-team corpus and these fixtures,
verify every profile through `validateVoiceProfile` and its storage constraints,
review rejected-output quarantine and retention, and obtain a fresh review of
rendering, digest verification, revocation and human sending authority. No live
provider call is part of E19. A future provider evaluation needs its own approved
region, retention, consent, credential and cost scope.

## Deterministic fixture format

[`support-ai-composed-reply-fixtures.json`](support-ai-composed-reply-fixtures.json)
contains fixed profiles, sources, citation spans and candidate outputs. Each pair
records the current E17 mechanical result and the proposed review disposition.
The accompanying Support test runs the current validator, validates and hashes
the profiles, and checks that each attack has its benign control. It is a fixture
integrity check, not an E19 runtime implementation. There is no preferred-word
segment in E17's runtime types or renderer.

## E17 route-shape deviation approved for R6

The module registry supports literal API paths. R6 uses
`POST /api/support/ai/suggestions/reviews` with exactly `suggestionId`,
`expectedTicketVersion` and `decision` in its JSON body, instead of
`POST /api/support/ai/suggestions/<id>/reviews`. `suggestionId` is a UUID.
Every operation derives tenant and actor from the current session. A foreign
suggestion and an absent suggestion return the same uncached 404. The user
explicitly approved this deviation on 2026-11-16. Parameterised module API routes
remain a framework follow-up for the integrator; R6 changes no shared matcher.

The user also approved an explicit `Use in reply` action after human review.
It fills the existing reply textarea and submits nothing. The human may edit
and must separately press the normal reply form's `Send` button. This replaces
the earlier composition document's clipboard-only control for this slice.

The shared platform module dispatcher exports POST only. The dedicated handler
implements the accepted GET read contract, but R6 does not change the dispatcher.
The ticket page instead loads durable state through the module-owned server
mount on every page render, after checking the current session and explicit
staff capability. Reloads therefore conceal revoked or expired content without
a browser GET dependency. The framework follow-up is
`method-aware module API dispatch (per-handler GET)`. Each handler must explicitly
opt into GET. Do not alias the shared POST dispatcher to GET, since that would
expose other modules' mutation handlers to browser-initiated GET requests.
Request, review and any future HTTP revocation writes remain POST operations
with the existing Origin/CSRF protections. Page reads never mutate suggestion
or ticket state.
An already displayed draft can remain in a browser until its next authorized
read or page reload. Revocation cannot recall text a human has already copied
into the normal reply editor.

## E17 integration checklist

The R6 tenant migrations are `0009_support_ai_review` and
`0010_support_ai_review_guards`; their module registrations and eight-table RLS
inventory are included. Migration catalogs and checksum baselines remain owned
by the integrator. Parameterised API matching is not needed for R6.

The default tenant control is suggestions off. Privileged operators own
`support.ai_controls`; its row lock serializes budget admission and its epoch
revokes earlier artifacts. Daily budgets use UTC. Actor rate limits use a rolling
hour. Defaults are 100 admitted requests per day, 10 per actor per hour and
30 days of content retention, bounded to 90 days. Synthetic mode requires an
explicit privileged tenant-local setting. It makes no external model call.

Before enabling routed inference, compose `createSupportAiApi(host, dependencies)`
with the existing model-routing port and independently read recorded preparation,
execution, parent linkage, completed stream-terminal and router-owned consent
basis. `SupportAiInferencePort` requires that verification. The host's current
port does not expose those records, so R6 fails closed without this composition.
Use `PgTenantVoiceProfileStore` to verify the current immutable digest and return
only `bannedWords`, version and digest. Provide the encrypted owner-only raw-output
quarantine with at most a 24-hour TTL. R6's runtime synthetic fixture has no raw
quarantine and refuses an invalid result with `audit_failure` if that port is
absent. No application prompt or rejected raw output enters suggestion tables.

Schedule the privileged `support.purge_ai_suggestion_content()` on the existing
retention path and invoke it with ticket purge. Reads already hide expired or
missing-ticket content. Application roles cannot delete or truncate it. No worker
or lifecycle wiring is part of R6. Authorization and module disablement conceal
the API on every read and review. Canonical knowledge update/delete revokes
artifacts through a database trigger, including later republication.

Add a separate CI db-sequence step named `support-ai-review`, filter `support`,
file `src/support-ai-review.integration.test.ts`, environment variable
`SUPPORT_AI_DATABASE_URL`, database `opentenant_it_support_ai`. Register that
fixed database in the fixture inventory and assert zero skips in the existing
step runner. The direct ephemeral proof can create this guarded database from
its harness-owned admin URL. Do not share the R3 delivery schema-reset database.

The reviewer sees immutable records and live visibility separately. The stored
terminal remains `review_required`; the review row holds one terminal human
choice, `reviewed` or `dismissed`. Staleness, revocation and expiry never rewrite
that evidence or grant sending authority.

## R6 local implementation evidence

The following receipts concern E17 and fixture integrity. They do not accept or
activate this E19 proposal. All test and build launchers ran through foreground
`forge-job run` units on 2026-11-16. Database proofs used the disposable
`pgvector/pgvector:0.8.2-pg17-bookworm` harness, with no provider calls.

| Command | Result |
| --- | --- |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/support test` | 193 passed across 28 files, zero skips. Includes 17 AI and all eight existing delivery integration cases. |
| `pnpm --filter @opentenant/support test` | 168 unit cases passed; the 25 database cases pass in the separate ephemeral proof above. |
| Support `typecheck`, `lint`, `build` | Passed. |
| `CI=1 pnpm e2e support.spec.ts support-accessibility.spec.ts support-email.spec.ts managed-support.spec.ts support-ai-review.spec.ts` | Seven passed, zero failed or skipped. Six legacy cases and one managed-support case. |
| `pnpm db:ephemeral -- pnpm ci:db-sequence` | Passed, zero skips. The new AI suite still needs its own registered CI step as described above. |
| `pnpm db:ephemeral -- pnpm rls:proof` | All 406 checks passed across 41 tables. |
| `env PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/turbo typecheck lint test --concurrency=2 --continue=always` | 114 of 115 tasks passed. Only `@opentenant/migrations#test` failed, with exactly the two new checksum entries below. No baseline was edited. |
| `./node_modules/.bin/turbo build --filter=@opentenant/platform --concurrency=2` | All 21 tasks passed. |
| `node scripts/check-module-special-cases.mjs` | Zero special cases. |
| `git diff --check 41adc71 HEAD` | Passed. |

The browser proof uses Beta, leaving the shared legacy tenant's queue and R3's
Alpha email fixture intact. Ticket, message, event, outbox and email snapshots
remain unchanged through generation, review and explicit editor prefill. Only
the human's edited normal reply submission creates a message. The same run
proves persisted reloads, identical foreign/missing review 404s, revocation
concealment, no horizontal page overflow at 390/768/1440 pixels and no panel axe
violations. All existing Support and accessibility browser cases pass alongside
it. The final test waits for the normal reply form's server refresh before
requesting a second suggestion. An earlier fixture attempt raced that refresh
and safely received a stale-version rejection.

The approved out-of-ownership edits are separate commits: `manifest.ts` registers
staff-only suggestion routes/capabilities plus the pre-approved migrations;
`host-ticket.tsx` mounts the staff-only panel and gives the existing reply form
a stable id. Shared FormField/FormStatus, Access denied, overflow regions and
mobile composition remain in place. No shared SDK, dispatcher, host port,
server configuration, worker, barrel or historical checksum was changed.

| Tenant Support migration | SHA256 |
| --- | --- |
| `0009_support_ai_review.sql` | `057dc45581617eed1b2e1a85c945822270b70d350cfe4fed77102b5b09fdaddc` |
| `0010_support_ai_review_guards.sql` | `73f2817640b9b702ce24674cd71420a78b585f0ed9900e6bfcc6e7bfa113deaf` |

Graphify's code refresh completed without a model call. Its SQL parser was
unavailable, and nine existing graph records lacked source-file metadata, so
source inspection and executable database proofs control the conclusions.
Generated graph files remain uncommitted. No push, full E2E run, accessibility
scan or live model request was performed.

Cleanup stopped and verified all 47 recorded R6 job units inactive.
`forge-job audit` and its persisted audit JSON report no unmanaged servers.
