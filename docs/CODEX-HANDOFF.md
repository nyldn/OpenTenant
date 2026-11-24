# Codex handoff: brand upload, apply step, and what is deliberately not done

Written 2026-07-28 by the Claude session that produced commits `599ef4f`
through `7746dc9`. Read this before touching the brand pipeline.

Repository rules still apply and override anything convenient here:
`.claude/CLAUDE.md`, `docs/HANDOFF.md`, `RTK.md`.

## Current reconciliation, 2026-11-17

The [E11 receipt ledger](plans/2026-11-17-e11-reconciliation.md) and
[operational handoff](HANDOFF.md) describe wave-6 baseline `d818389`.
The original brand-task brief and dated proofs below remain historical.

Support now has persistent review-only suggestion UI/API composition and
durable email. Routed inference and rejected-output quarantine remain disabled
pending their documented dependencies. Preferred words, examples and style
fields remain inert. Quality-contract persistence and a trusted host factory
exist; Lab phases 1 through 4 remain deferred, with no HTTP caller or publishing.

Developer MCP has both a separate provider lifecycle proof and a
[real local route proof](reviews/2026-11-17-developer-mcp-route.json), including
OAuth/PKCE, human confirmation, VM teardown and single-use static preview.
Production remains disabled behind OWNER-DEVELOPER-MCP-02. Model-provider
adapters exist with synthetic verification only; no live validation is recorded.
The Brain page exists as an unavailable state, not composed browser retrieval.

Current counts and commands belong in the receipt ledger, not the old 57/63-task
or migration snapshots below. GitHub Actions is billing-blocked; no hosted CI
receipt or OWNER-KVM-CI-01 runner proof is supplied. V3 passes six frozen budget
tests but Assessment still misses LCP/CLS; UAT-015 stays open. Current wave-7 UAT
pass rate and ECS are **PENDING integrator receipts**. Marketing impact: none.

## Historical status, 2026-09-06

This file preserves the original task brief and its rejected-run lessons. For a
current requirement-by-requirement view, use
[`plans/product-requirements-status.md`](plans/product-requirements-status.md).

The parser, upload provenance schema, proposal review/edit/apply stores, six
brand permissions, and immutable voice profiles are committed. The tenant
administrator page accepts a bounded `brand.md` upload, shows its provenance,
and keeps review and apply separate. A different file can replace a live draft
only when the same tenant session also has `brand.proposal.supersede`; denial
preserves the draft and audit state. Lab Phase 0 is committed in `f2a8db9`; Lab
phases 1 through 4 remain deferred. Support AI now pins the
applied voice-profile version and digest and enforces banned words. Preferred
words, example rewrites, and the five style fields remain inert.

---

## Completion update, 2026-07-29

The first task defined in §6 is complete on
`codex/brand-apply-20260729`, including two follow-up defects found only by
executing against PostgreSQL. The reviewed proposal now applies atomically to
`brand_policies.overrides`, respects per-key locks, rejects policy-version
drift, terminalizes exactly once, and writes one canonical audit event.

Final proof passes 92/92 migration tests across 11 files and 2/2 live
brand-proposal store tests, including two real connections racing the same
review while an unrelated tenant has a `tenant_modules` dependency. The
controller also passed the 57/57 monorepo matrix and the 27-page platform
build. `BRAND-APPLY-01`, `BRAND-APPLY-02`, and `BRAND-APPLY-03` are
`completed`; the historical “Not done” wording below is retained as the
original task brief and is superseded for §2 items 1 and 2 and §6.

---

## 1. Read these first, in this order

1. `docs/product/brand-and-voice-documents.md` — the accepted PRD. Sections 11
   (five resolved decisions), 12 (build order) and 13 (twelve acceptance
   criteria the document originally implied and never stated).
2. `docs/plans/2026-07-28-brand-voice-nlspec.md` — the same thing restated as a
   spec, scoped to build steps 1 to 4, with 14 numbered acceptance criteria.
   The PRD wins where they disagree.
3. `docs/HANDOFF.md`, the two sections dated 2026-07-28: how migrations get
   executed, and the open OPS-13 finding F4.

## 2. State of the work

### On `main`, done and verified

- **Upload provenance.** `ProposedBrandValue` provenance is a discriminated
  union of `https` and `upload`. `packages/platform-core/src/brand-proposal.ts`.
- **`brand.md` parsing.** Deterministic, no model.
  `packages/platform-core/src/brand-document.ts`. 256 KiB and 64-key ceilings,
  per-key rejection, headings and fenced blocks.
- **Voice profile.** Closed vocabularies, no free-text field, validated on save.
  `packages/platform-core/src/voice-profile.ts`.
- **Brand token validation.** `packages/platform-core/src/brand-validation.ts`.
- 51 platform-core tests. Turbo sweep 57/57.

### Migration `0020`, merged and verified by execution

`tooling/migrations/sql/control-plane/0020_brand_upload_provenance.sql` and
`tooling/migrations/src/control-plane-brand-upload.integration.test.ts`, merged
as PR #35. Two provenance shapes exclusively, uploads minting a seed request
with an `upload:<digest>` URI, `superseded` and `applied` statuses with
constrained transitions, applied made terminal by trigger, one live draft per
tenant.

It went to a branch rather than `main` because Docker would not start on the
authoring machine, so CI was its first real execution. **It failed that first
run**, and the failure is instructive. `0013` declared the status check inline
on the column, so PostgreSQL auto-named it `brand_proposals_status_check`;
`0020` tried to add a constraint with the same name, hit "already exists", and
aborted the migration, taking down every control-plane suite rather than only
the new one. The name collision was the symptom. The defect was that the
original check still restricted status to the three old values, so `superseded`
and `applied` could never have been stored even had the name been free.

Substring assertions against the migration text would have passed it cleanly.
Both statements are in the file and read correctly. Only executing it shows the
second cannot run. Treat this as the worked example for the rule in §3.

Green now: 91 tests across 11 files in `migration-execution`, up from 78 across
10, so the 13 new cases ran rather than skipped.

### The four-item dependency chain: all merged as of 2026-08-01

Delivered between 2026-07-29 and 2026-07-31, verified at `05f080b` with a green
60/60 turbo sweep. Recorded here rather than deleted, so the chain reads end to
end.

1. **The apply write.** `PgBrandProposalStore.apply`,
   `packages/database/src/brand-proposal-store.ts:331`, with migration
   `0021_brand_proposal_apply.sql` pinning `reviewed_policy_version`. One
   transaction, `for update of proposal, policy`, merges into `overrides`,
   version-guarded update, one audit row. PR #36, `3681c2c`.
2. **Lock rejection.** `classify` at `brand-proposal-store.ts:136` splits
   applicable from locked keys and attaches a reason per key. Surfaced before
   the operator confirms by `preview` at `:181`. Both appear in the applied
   result and the audit detail.
3. **Six distinct permissions**, tenant-bound. PR #37, `2448ff8`.
4. **Parser version registry.** PR #38, `18450f5`, migration `0022`.

Landed alongside them: provenance-preserving proposal edits (PR #39, `a10bf7d`,
migration `0023`) and immutable tenant voice profiles (PR #40, `8b4d776`,
migration `0024`). The voice profile is stored, validated and digest-pinned, and
is still wired to no generation path, which remains correct: see §5.

### Module Improvement Lab Phase 0: delivered 2026-08-01, committed in `f2a8db9`

`packages/quality-contract`, 51 tests, sweep green at 63/63. The six schemas
from PRD §9 with the §6.1 and §6.2 rules encoded as validation, and a
deterministic baseline-versus-candidate evaluator proven on a synthetic checkout
module. No migration, no database, no model call.

The load-bearing rule is in `evaluateCandidate`: a proposed contract change is
assessed for weakening *before* any result is read, and everything after that
runs against the union of the baseline contract and the proposal's additions. A
candidate cannot buy acceptance by relaxing the rules it is about to be judged
by. `effectiveContract` keeps the baseline definition on an id collision so a
missed relaxation is inert rather than load-bearing.

Two things worth knowing. Regression benchmarks are permanent regardless of
owner, because each encodes a failure that already happened. And element order
is canonicalised by id inside `validateQualityContract`: without it the digest
was order-sensitive, and a proposal that merely reordered its outcomes would
have been rejected for a formatting difference. A test covers that case.

Not done in Phase 0, deliberately: nothing is persisted, no contract is bound to
a real module version, and phases 1 to 4 remain gated on Developer MCP tenant
binding and a production-approved sandbox adapter.

### Not done. This is your work.

Lab phases 1 to 4 in `docs/product/2026-07-19-module-improvement-lab-prd.md` §9
are gated on Developer MCP tenant binding and a production-approved sandbox
adapter, so do not start them. What is actually open, in dependency order:

1. **Freeze the prompt template scaffold** as a versioned artifact with a closed
   string vocabulary, pinned per inference. This blocks the containment check
   and therefore blocks all voice conditioning. See §5.

   **Corrected 2026-08-01. The paragraph this replaces was wrong.** It claimed
   no prompt assembly existed anywhere in the repository. It does:
   `modules/support/src/support-ai.ts` defines `PROMPT_TEMPLATE_VERSION` and
   pins it into the per-inference prompt digest. The search behind that claim
   covered `packages/` and `apps/` and never looked in `modules/`. An
   independent Codex review found the file.

   The correction changes the item rather than merely fixing a fact. The
   scaffold freeze is **not** a prerequisite for containment, because the
   implementation composes a reply as its verbatim cited sentences concatenated
   and admits no scaffold text at all. It becomes a prerequisite only for a
   composed-reply proposal, which is where greetings, connectives and sign-offs
   first need a source. Do it there, not before.
2. ~~**Refuse negations and function words as `bannedWords` entries.**~~ Done,
   application and database both. `VOICE_PROFILE_MEANING_BEARING_WORDS` in
   `voice-profile.ts`, migration `0025`, parity proven by execution. Executed
   locally against PostgreSQL 17.10 and green on first run: 122 tests across 14
   files, up from 36 with no database attached. Note the version gap, 17.10
   locally against CI's pg17 image; nothing in `0025` is version sensitive, but
   the gap is real and unexamined.
3. ~~**Implement the containment predicate.**~~ There is nothing to implement.
   Containment is already enforced in `support-ai.ts:validDraft`, more strictly
   than the first v3 draft proposed. That draft would have relaxed it to
   token-level attribution and has been withdrawn. Citation boundaries are now
   constrained to whole sentences, closing a live defect where a body reading
   "You are not eligible after 30 days." could be cited as "eligible after 30
   days." with the slice matching character for character.
4. **A composed-reply proposal**, if readable replies are wanted. Today a reply
   is its cited sentences joined by spaces, with no greeting or connective. This
   is the work that unlocks voice conditioning, needs the scaffold freeze, and
   must carry its own evidence. It is a product decision first, not a
   refactor: it trades a gate that structurally cannot recombine for one that
   can.
5. **Persist quality contracts** if and when a Lab phase needs them. Phase 0 is
   in-memory by design.

## 3. Rules that are not negotiable here

**Assert migration behaviour by executing it.** Write rows the constraint must
refuse. Do not assert substrings of the SQL text. `0018` shipped as invalid
PostgreSQL behind twenty passing `expect(sql).toContain(...)` assertions,
because no CI job had ever executed a control-plane migration. That harness now
exists; use it. `tooling/migrations/src/control-plane-brand-upload.integration.test.ts`
is the pattern to copy.

**Never fabricate provenance.** An upload must not be given a synthetic
`sourceUrl` to satisfy the HTTPS check. That check is now discriminated
precisely so the shortcut is impossible; do not reintroduce it in application
code.

**No model call in this scope.** No prompt assembly, no adapter, no
`ModelRouter`. The voice profile is stored and validated and wired to nothing.

**Voice conditions nothing customer-facing** until `docs/product/support-ai-boundary.md`
gets a v3 amending its 100% suggestion-containment gate (line 147, "no content
outside cited spans"). That is an owner decision, recorded at the top of the
brand PRD, and it is not yours or mine to make. See §5 below, there is a known
hole in it.

**Owner gates are the owner's.** `OWNER-SLACK-01`, `OWNER-COMPLIANCE-01`,
`OWNER-DEVELOPER-MCP-02` are `pending` in `docs/plans/unattended-backlog.json`.
Build the prerequisites; never flip the gate.

## 4. Local setup, reconciled 2026-11-17

Use Node 22 and pnpm 11.13.1. The original stock-Postgres setup and 36/122-test
comparison described the July brand task. They are not a complete proof of the
current migration inventory, which includes Brain and requires pgvector.
Use the unique, loopback-only disposable harness with the CI image
`pgvector/pgvector:0.8.2-pg17-bookworm`, as documented in the
[database guide](tooling/db-ephemeral.md). Missing pgvector or skipped database
cases fail the proof. Run long commands under foreground `forge-job run` jobs.

```sh
forge-job run opentenant-quality -- pnpm turbo typecheck lint test
forge-job run opentenant-migrations -- pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test
forge-job run opentenant-db-sequence -- pnpm db:ephemeral -- pnpm ci:db-sequence
```

The committed V1 receipt records 115 quality tasks, full migrations 178 passed
with zero failures/skips, and the separate sequence's 17 steps/358 cases. These
commands have not been rerun by this documentation task. The serial migration
suites use destructive synthetic schemas; never substitute a shared or genuine
tenant database. An ordinary root test run may skip database cases, so it does
not replace the dedicated proof.

## 5. Things I got wrong or left open. Do not repeat them.

**The containment gate hole. Ruled on 2026-08-01; this entry is kept because
the correction matters more than the finding.** PRD §11 decision 1 admits the
voice profile as a second sanctioned source, with containment redefined as "no
content outside cited spans or the applied voice profile's structured fields".
That attribution rule works for banned and preferred words, which are literal
strings a mechanical check can trace. It does **not** work for the style fields,
which change wording attributable to no specific field, so the check either
passes everything or fails everything.

The owner ruled for the recommendation in PRD §13, narrowing the sanctioned set.
Making it precise corrected the finding above in four ways:

1. **Five fields are affected, not three.** I named formality, tense and reading
   level. `person` and `sentenceLength` have the identical defect and I missed
   them.
2. **`bannedWords` was never a sanctioned source.** It is subtractive. Its real
   risk is the inverse and I did not see it: nothing stops a tenant banning
   `not` or `never`, and dropping a banned negation from a span-faithful
   sentence inverts meaning while passing every token check. Containment is
   additive and blind to deletion. A save-time negation denylist is new work.
3. **`exampleRewrites` are sanctionable only literally.** As few-shot style
   teachers they reopen the hole through the examples.
4. **The v2 gate was never satisfiable by any draft**, voice or not. Greetings,
   connectives and sign-offs come from the prompt template, which is an
   unacknowledged third source. Freezing the template scaffold as a versioned
   artifact is a prerequisite that blocks implementation of the check.

Recorded in `support-ai-boundary.md` §3.8 and §6, drafted 2026-08-01 and
awaiting owner acceptance. **Do not build generation conditioning until the v3
is accepted and the scaffold freeze exists.**

**OPS-13 F4 is open and constrains the model router.** `tenantId` is
caller-supplied and is the router's only tenant binding; residency, consent,
credential scope and attribution all derive from it. `TENANT_POLICY_MISMATCH` is
**not** a security check: it compares the store's answer against the value the
store was asked about. Any HTTP or MCP surface in front of `ModelRouter` must
derive the tenant from the authenticated session. Documented on `ResolveInput`.

**Sandbox egress is fixed at the policy layer only.** `30fef65` closed
`validateHost`, which had accepted `169.254.169.254`, `localhost`, RFC 1918 and
`metadata.google.internal` because it was a DNS-label grammar check wearing the
name of a security control. It now refuses IP literals in every notation
`inet_aton` accepts, single-label names, and internal suffixes, with 21 denial
cases proven by stashing the fix and confirming exactly 21 failures. **It does
not stop a permitted name resolving to a forbidden address.** DNS rebinding
still works. Connect-time denial against the IP actually dialled belongs in the
adapter and does not exist. This is one of eleven `OWNER-DEVELOPER-MCP-02`
criteria; the gate stays open.

**The factory-generated code needed correcting before it compiled**, and two of
the four defects were in its *tests*, which is the dangerous kind. One asserted
that NFC folds an accented word into its unaccented spelling; it does not, those
are different words rather than different encodings of one. Another padded a
buffer with the zero fill `new Uint8Array` gives, so a NUL tail became part of a
parsed value and was correctly refused, meaning the test exercised NUL handling
rather than the size boundary it was named for. Run generated tests against
deliberately broken implementations before trusting them.

## 6. Definition of done for your first task

The apply write, item 1 in §2. It is done when:

- Two actors applying the same reviewed proposal concurrently produce exactly
  one success, one version bump and one audit row; the other fails on conflict.
  Prove it with two real connections, not two sequential calls.
- Apply fails rather than clobbering when `brand_policies.version` moved between
  review and apply.
- A proposal with one locked and two unlocked keys applies two and reports one
  with a reason.
- Every new constraint has a test that writes a row it must refuse.
- `pnpm turbo typecheck lint test` is 57/57 and the migration suite passes with
  a real database attached.

Report what you did not do as plainly as what you did.
