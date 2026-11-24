# Product requirements: uploaded brand and voice documents

Status: **Accepted 2026-07-28.** Approved for delivery by the owner, with the
five decisions in section 11 resolved to the recommendations stated there.

Date: 2026-07-28

Decision owner: Chris

**Decision 1 amends an accepted artifact.** Admitting the voice profile as a
second sanctioned source changes the suggestion-containment gate in
`support-ai-boundary.md:147` from "no content outside cited spans" to "no
content outside cited spans or the applied voice profile's structured fields".
That document needs a v3 recording the amendment and its rationale before any
voice-conditioned draft ships. Until that edit lands, voice conditions nothing
customer-facing.

Depends on: `OPS-03` brand seeding, `ADR-006` model selection and residency,
`OWNER-AI-01` support AI boundary.

## Current delivery status, 2026-09-07

The deterministic parser, upload provenance and parser-version schemas,
proposal review/edit/apply behavior, six permissions, immutable voice-profile
storage, unsafe-text checks, and banned-word enforcement are committed and
tested locally. The tenant administrator page now accepts a bounded `brand.md`
file and carries its original-byte digest and parser version through review and
apply. Upload and supersede remain separate permissions: the transaction keeps
an existing draft and writes no new audit event unless the current tenant
session also holds `brand.proposal.supersede`.

Preferred words, example rewrites, and the five style fields do not condition
customer-facing text. They remain inert under the accepted August 3 ruling.
See the [current requirement ledger](../plans/product-requirements-status.md)
for the deliverable-by-deliverable status and source/test references.

## 0. What changed from v1, and why

The historical review below describes the pre-implementation state. v1 asserted
that a `brand.md` upload would inherit the existing proposal
lifecycle "unchanged" and that a `voice.md` file would condition reply drafts.
An adversarial review against the code found both premises false, and the
verification confirmed all three blockers:

- **There is no apply step and no edit step.** `brand-proposal.ts` exports
  `createBrandProposal`, `reviewBrandProposal` and `discardBrandProposal` and
  nothing else. The strings "apply" and "locked" appear zero times in that file
  and zero times in its test. `0013_brand_seed_proposals.sql:1-3` states it
  directly: proposals "remain review/discard records until a separate apply
  operation exists." The step that writes `brand_policies` is unbuilt.
- **The proposal pipeline is URL-shaped and rejects uploads by construction.**
  `createBrandProposal` throws "Brand values require valid HTTPS provenance" for
  any value without an `https://` `sourceUrl` (`brand-proposal.ts:44-53`), and
  the database enforces the same through
  `brand_proposals_values_provenanced` (`0013:67`). `brand_proposals.request_id`
  is `not null` and FK-bound to `brand_seed_requests`, whose own source is an
  HTTPS URL. A file has no URL. "Unchanged" would force an implementer to
  fabricate a `sourceUrl`, which is provenance fraud in the one pipeline whose
  entire purpose is provenance.
- **Voice-conditioned reply drafts collide with an accepted hard gate.**
  `support-ai-boundary.md:147` sets "Suggestion containment | 100 %, hard | No
  content outside cited spans; no URL absent from a cited source." Preferred
  words, banned-word substitutions and example rewrites are by definition
  content traceable to no retrieved span. v1 never mentioned the gate.

v2 restructures accordingly. The `voice.md` **upload** is dropped from v1 in
favour of a structured profile with no free prose. Section 4 now names apply,
edit and upload provenance as new deliverables rather than inherited behaviour.

## 1. Summary

A tenant uploads `brand.md`. Deterministic parsing turns it into a **brand
proposal** that a human reviews and applies to the existing brand policy.

Separately, a tenant fills a **voice profile** of closed-vocabulary fields that
conditions model-generated drafts. There is no `voice.md` upload in v1.

## 2. Why the voice upload is dropped

v1's own section 5.2 conceded the endgame: everything useful about a style guide
parses into structured fields, and the only content crossing unstructured was a
free-text `notes` block. That block was simultaneously the only injection
channel, the only thing colliding with the containment gate, the reason the
whole prompt-injection subsection existed, and the source of the unanswerable
"how big should the limit be" question.

A form with closed vocabularies can be validated in code the way triage output
already is. It collapses the containment story to mechanisms the platform
already trusts. A tenant with an existing style guide fills a form once.

If file import earns its place later, ship it as **import-time convenience that
pre-fills the form**, so the stored and prompt-crossing artifact is always the
structured profile and the upload is interface sugar rather than a new data
class.

## 3. Goals

- Let a tenant seed brand from a file they already keep, through the existing
  reviewed proposal path rather than a second write path into `brand_policies`.
- Build the apply step that the seeding pipeline has always been missing.
- Give model-backed drafting a tenant voice without introducing a prose channel
  into a model context.
- Keep every applied version attributable, re-derivable and revocable.

## 4. `brand.md`: deterministic, reviewed

### 4.1 What is extracted

Only keys already in `BrandTokenKey` (`branding.ts:11-29`). An uploaded document
cannot invent a token, because a token the resolver does not know renders
nothing.

Extraction is **deterministic parsing, not a model**: fenced key/value blocks and
a small set of recognised headings. A model may later *suggest* a mapping for
unrecognised content, but the value reaching a proposal comes from the parser.
Determinism is what lets the operator diff the proposal against their own file.

`brand.md` gets the same input hardening the URL fetcher has: a size ceiling, a
media-type check, and defined parser-failure behaviour. A file parsing to zero
recognised keys is an error listing the headings it did find, not an empty
successful proposal.

### 4.2 New deliverable: upload provenance

The proposal type and the CHECK constraint accept exactly one provenance shape,
an HTTPS URL with a retrieval timestamp. This PRD adds a second:

```
{ kind: "upload", fileDigest, uploadedByUserId, uploadedAt }
```

Work required, none of it inherited:

- Discriminate `ProposedBrandValue` provenance on `kind`, keeping the existing
  URL validation intact for the URL variant.
- Migrate `brand_proposal_values_are_provenanced` to accept both shapes and
  neither anything else.
- Decide `request_id`. It is `not null` and FK-bound to `brand_seed_requests`,
  a table keyed on a source URL an upload does not have. Either uploads mint a
  synthetic request row with an upload-kind source, or `request_id` becomes
  nullable with a CHECK tying nullability to provenance kind. **Recommendation:
  synthetic request row**, because it preserves `brand_proposals_one_per_request`
  and keeps one table answering "where did this proposal come from".

### 4.3 New deliverable: apply, and edit

Neither exists. Both need specifying before either is built.

- **Which layer does an applied value write?** `brand_policies` carries
  `defaults`, `locked_keys` and `overrides` (`0001:39-45`). Locks constrain
  `overrides` and not `defaults` (`branding.ts:36-39`), so the target layer
  decides whether locks apply at all. **Recommendation: `overrides`**, so an
  uploaded value is subject to the same locks a manual tenant change is.
- **Version semantics.** `brand_policies.version` increments; `0005` maintains
  `updated_at`. Apply bumps both.
- **Audit.** One `audit_events` row per apply, carrying actor, reason and policy
  version, per the evidence contract in `ADR-006` §5.
- **Lock rejection is new behaviour.** v1 claimed "`locked_keys` still wins: an
  uploaded value for a locked key is shown as rejected with the reason". No such
  path exists. The only lock handling in the codebase is `resolve-brand.ts:43-47`,
  which returns bare `rejectedOverrideKeys` with no reasons and whose own comment
  says locked values "silently win". Proposal-time rejection with reasons must be
  built, and it depends on the apply-target decision above.

### 4.4 Re-upload

v1 said re-uploading "supersedes the previous draft". Nothing supersedes today:
status is closed to `draft | reviewed | discarded` (`0013:59`) and
`brand_proposals_one_per_request` is unique.

**Decision required.** Auto-discarding the prior draft overloads `discarded`,
which currently means a human rejected it, and pollutes the audit meaning.
**Recommendation: a `superseded` status**, added to the vocabulary, so "a human
said no" and "a newer file arrived" stay distinguishable in the audit trail.

## 5. Voice profile: structured, no prose

### 5.1 Shape

Closed-vocabulary fields, validated in code: reading level, formality, person,
tense preference, sentence-length preference, banned words, preferred words, and
a bounded list of example rewrites. No free-text field. No `notes` block.

Banned and preferred words are word lists, not instructions, and are length-
bounded. Example rewrites are before/after pairs, bounded in count and length.

### 5.2 The containment gate, which needs an owner decision

`support-ai-boundary.md:147` requires 100% suggestion containment: no content
outside cited spans. A voice profile shapes draft text that traces to no
retrieved span. Two honest options:

1. **Voice does not touch customer-facing drafts.** The gate stands unchanged.
   Voice applies only to internal-facing generated text. Cheapest, and narrow
   enough that the feature may not be worth building.
2. **Voice becomes a second sanctioned source.** Containment is redefined as "no
   content outside cited spans **or the applied voice profile's structured
   fields**", the profile is versioned, and the mechanical check gains a rule
   that draft vocabulary deltas must be attributable to profile fields.

**Recommendation: option 2**, because option 1 leaves the feature without a use.
This is an amendment to an accepted artifact and requires owner sign-off plus a
v3 of the boundary document. It is not an implementation detail.

### 5.3 What is not a containment mechanism

v1 claimed authority statements assembled after the voice block "are not
overridable by it". That is placement, not enforcement, and
`ai-support-agent.md:109-110` already requires injection be "structurally unable
to reach authority, rather than filtered on a best-effort basis". The claim is
withdrawn.

Removing free prose is what makes the argument hold: closed vocabularies and
bounded word lists have no room for an instruction. That is a structural
property, not a mitigation.

One residual risk survives and should be named. Even structured fields shape
customer-facing text approved under the fatigue conditions R-9 already flags. A
preferred-word list is a poor vehicle for an attack, but the draft red-team set
should gain non-URL contact-solicitation patterns, since the URL rule and the
prohibited-actions list both pass text of that kind.

### 5.4 Review before effect

A profile takes effect only after a human in the tenant applies it.

## 6. Residency, retention and evidence

- **Inference records must pin the profile.** `support-ai-boundary.md:74-76`
  requires the prompt digest to have a reference object. A voice-conditioned
  prompt whose record does not name the applied profile version and digest is
  not re-derivable, which is the defect v2 of that document fixed. The profile
  version joins the input watermark.
- **Retention rides the call.** The profile travels on existing
  `ModelRouter.complete` calls, so the posture filter at
  `model-routing.ts:294-302` already applies. A tenant requiring
  `zero_retention` for tickets gets it for voice. State this rather than leaving
  it implied.
- **Cross-border consent wording.** `ADR-006` §5 words consent around "ticket
  content". Brand and voice are a different content class crossing the same
  border. **Decision required:** extend the wording, or record that the existing
  consent covers them. **Recommendation: extend**, because the consent record
  stores what was agreed and a later auditor reads the words.
- **Storage plane.** Both the uploaded document and the profile live in the
  **control plane**, alongside `brand_policies`, which is where brand
  configuration already lives. Control-plane tables carry no RLS today; tenant
  scoping is by `tenant_id` foreign key and application-layer authorisation. If
  that is wrong for tenant-authored content, it is wrong for `brand_policies`
  today and should be raised separately rather than solved here.

## 7. Data model and harness obligations

- New tables for the uploaded document, the voice profile and profile versions.
  If any lands in the tenant data plane instead, it must join the inventory in
  `tooling/ci/rls-proof.mjs`, and `rls-inventory.test.mjs` will fail the build if
  it does not.
- Every new migration is now executed for real by the `migration-execution` CI
  job, and constraints get behavioural tests rather than substring assertions.
- **Parser version registry.** Section 6 of v1 promised to record "the parser
  version" with no registry, no column and no statement of what happens to
  existing proposals when the parser changes. Versions are immutable and
  recorded per proposal; a parser change never rewrites an existing proposal.
- **Deletion is event-driven.** Goal "revocable" needs a path. Following the
  embeddings precedent in `support-ai-boundary.md:96-97`, revocation deletes on
  the revocation event rather than by a later sweep.

## 8. Ownership: tenant-private in v1

v1 claimed section 6 followed "the module ownership scopes already in use", with
an owner publishing a shared default that tenants inherit and override. That
conflates two unrelated mechanisms. The scope vocabulary
(`platform | installation | tenant`, `modules.ts:6-13`) has no inherit-and-
override semantics: installation-owned modules are *assigned*, and promotion
mints a new identity with a new key, version and digest (`modules.ts:255-263`).
Inherit-and-override is the *brand cascade*, which is per-tenant:
`brand_policies` is keyed on `tenant_id` as primary key with no installation
row. Neither model gives an owner-shared default a home.

v1 also asserted the mechanism in section 6 while asking whether it should exist
in open question 4.

**v1 scope: tenant-private only.** If owner-shared defaults later earn their
place, they are a cascade extension (a nullable installation-level row resolved
before tenant values), not an ownership scope.

Correspondingly, the absolute claim that a profile "never contributes to another
tenant's generation" is qualified: a voice-conditioned knowledge article
promoted from tenant-private to owner-shared carries tenant-voice-shaped text
into other tenants' retrieval. That promotion is human-gated by a different
human, per `support-ai-boundary.md` §4, but the claim is not absolute.

## 9. Existing seeding overlap

`multi-tenant-operations.md` §5 already lists "tone and voice notes" among
URL-seeding proposals, yet `BrandTokens` has no voice key, so those notes have
nowhere to land today. The voice profile is their home: seeded tone notes become
a proposed profile, subject to the same review.

## 10. Non-goals

- No `voice.md` upload in v1.
- No model-authored brand values reaching a proposal without a parser.
- No second write path into `brand_policies` bypassing the proposal lifecycle.
- No cross-tenant inheritance of brand or voice.
- No live preview rendering uploaded content as HTML.

## 11. Decisions, resolved 2026-07-28

All five resolved to the recommendation stated in the section that raised them.

1. **Voice and the containment gate: option 2.** The voice profile becomes a
   second sanctioned source. Containment reads "no content outside cited spans
   or the applied voice profile's structured fields", the profile is versioned,
   and the mechanical check gains a rule that draft vocabulary deltas must be
   attributable to profile fields. `support-ai-boundary.md` needs a v3 recording
   this. **Voice conditions nothing customer-facing until that edit lands.**

   **Narrowed on 2026-08-01, owner ruling.** Implementation review found the
   attribution rule unenforceable for the style fields; see the hole recorded in
   §13. The sanctioned set is narrowed to `preferredWords` and
   `exampleRewrites.after` (**superseded 2026-08-03, see the re-ruling below**),
   with `bannedWords` enforced as absence rather than
   sanctioned as a source. `readingLevel`, `formality`, `person`, `tense` and
   `sentenceLength` are deferred from anything customer-facing and are stored as
   evidence only. Sanctioning any of them later is a separate decision with its
   own gate design. Recorded in `support-ai-boundary.md` §3.8 and §6, **accepted
   2026-08-03**.

   > **Re-ruled by the owner on 2026-08-03.** `exampleRewrites` move to the
   > deferred set, alongside the five style fields. The sanctioned set is now
   > `preferredWords` alone, with `bannedWords` enforced as absence.
   >
   > Two reasons, both found by independent review. Sanctioning example rewrites
   > "in literal capacity only" is not enforceable: withheld from the model they
   > can never be reproduced verbatim, and supplied as few-shot input they teach
   > diffuse imitation as unattributable as formality. And a verbatim-substring
   > rule licenses fragments, so an `after` of "We cannot offer refunds" would
   > sanction "offer refunds".
   >
   > A third reason arrived with composed replies on the same day and settles it
   > independently of either: every character of a composed reply comes from a
   > cited span or the frozen scaffold table, so example text has no position in
   > a reply to occupy. Sanctioning it would have been inert as well as
   > unenforceable.
   >
   > The field stays stored and validated. Nothing in migration `0024` changes.
   > `preferredWords` is likewise stored and currently inert for the same
   > structural reason; only `bannedWords` affects output today, enforced as
   > absence over the rendered reply.

2. **Apply target layer: `overrides`.** An uploaded value is subject to the same
   locks a manual tenant change is.
3. **Upload provenance: synthetic request row.** Preserves
   `brand_proposals_one_per_request` and keeps one table answering where a
   proposal came from.
4. **Re-upload: a `superseded` status.** "A human said no" and "a newer file
   arrived" stay distinguishable in the audit trail.
5. **Cross-border consent wording: extend it.** The consent record stores what
   was agreed, and a later auditor reads the words.

## 12. Historical build order and current state

This was the accepted dependency order. The status notes below record the
current source without changing the original acceptance policy.

1. Upload provenance (§4.2). `implemented locally`.
2. The apply step and lock rejection (§4.3). `implemented locally`.
3. `brand.md` parsing and input hardening (§4.1), plus the `superseded`
   transition (§4.4). `implemented locally` as library and schema behavior; the
   application upload transaction is still missing.
4. The voice profile as a stored, versioned, tenant-private record (§5.1, §8),
   with no unsupported generation fields wired up. `implemented locally`.
5. Consent wording extension and the inference watermark join (§6). `partial`:
   Support AI pins the profile version and digest, while persistent routing and
   consent readback remain unfinished.
6. Generation conditioning. `deferred` under the accepted v3 field ruling.

Steps 1 through 4 describe committed lower-level behavior. They do not make the
missing application upload journey or deferred voice conditioning available.

## 13. Acceptance criteria the document implied and never stated

Raised by an adversarial coverage pass before implementation began. These are
requirements, not suggestions.

**Concurrency and staleness**

- Two actors applying the same reviewed proposal: exactly one succeeds, one
  version bump, one audit event. The rest fail on conflict.
- Locks or overrides changed after review: apply must not overwrite a newer
  manual change. Compare `brand_policies.version` optimistically and fail rather
  than clobber.
- Locked keys reject **per key**, not the whole apply, and the rejected keys and
  reasons are shown before the operator confirms.

**Parsing**

- Duplicate keys, conflicting headings, or one malformed recognised value: reject
  **per key** with the reason, and never apply a partially understood file
  silently. Every value is type-validated against its `BrandTokenKey`.
- The digest is SHA-256 over the raw uploaded bytes, not over normalised text, so
  two files that differ only in whitespace are two files.
- Re-upload of an identical digest is a no-op, not a new proposal. An **applied**
  proposal is never superseded; supersession applies to `draft` only.

**Authorisation**

- Upload, review, edit, apply, supersede and revoke are each a distinct
  permission, each bound to an exact tenant. A managed-support actor is not a
  tenant admin.
- An operator edit preserves the original provenance, records actor and reason,
  and invalidates any prior review. Editing after apply or supersession is
  refused.

**Voice**

- A generation call pins one immutable profile version for its whole lifetime,
  including retries. A profile changed or revoked mid-call does not change the
  call.
- Revocation must not destroy inference evidence that references the profile.
  Following the model-routing precedent in `0019`, evidence is append-only and
  revocation is recorded, not erased.
- Banned and preferred lists are canonicalised before comparison (case, Unicode
  normalisation) and contradictory entries, a word both banned and preferred,
  are rejected at save time rather than resolved at generation time.
- An example rewrite containing an instruction, URL, credential or contact
  solicitation is **rejected at save time**. Length bounds are not sufficient;
  this is the residual channel §5.3 names.
- Voice-conditioned generation blocks when cross-border consent is absent,
  revoked, or predates the extended wording. There is no in-region fallback that
  silently drops voice, consistent with ADR-006 §7's rule that slots stop
  resolving rather than substituting.

**A hole in decision 1, stated plainly**

§5.2 option 2 redefines containment as "no content outside cited spans or the
applied voice profile's structured fields", and §11 resolved to it. The
attribution rule works for banned and preferred words, which are literal
strings a mechanical check can trace. It does **not** work for the five closed
vocabulary style fields, being `readingLevel`, `formality`, `person`, `tense`
and `sentenceLength`: those change wording that maps to no specific field, so a
mechanical attributability check either passes everything or fails everything.

An earlier draft of this paragraph named only formality, tense and reading
level. That was wrong by two. `person` shifts change verb agreement, reflexives
and determiners across every sentence, and `sentenceLength` shifts require
connectives and capitalisation from no field. Both have the identical defect.

This was not visible when decision 1 was taken. Two ways out:

1. **Narrow the sanctioned set** to the fields a mechanical check can actually
   verify, being the word lists and the example rewrites, and drop all five
   style fields from anything customer-facing.
2. **Change the gate's shape** for those fields, from attribution to a bounded
   semantic-equivalence check against an unconditioned draft.

**Recommendation: option 1 for the first release.** It keeps the gate mechanical
and honest, which is the property the boundary document was written to protect,
and it costs little: word lists carry most of what a house style actually
enforces. Option 2 needs its own evaluation design and should not be bundled
into this delivery. This choice belongs in the `support-ai-boundary.md` v3 edit
rather than being settled here.

**Ruled on 2026-08-01: option 1.** Three corrections came out of making it
precise, and they are acceptance criteria for the v3 edit rather than
restatements of it:

- `bannedWords` is not a sanctioned source. It is subtractive and adds no
  content, so it needs no sanctioning under an additive attribution rule. It is
  enforced as absence.
- `exampleRewrites` are sanctioned in their literal capacity only, meaning
  verbatim reuse of `after` text. If the examples act as few-shot style
  teachers, the diffuse imitation they induce is exactly as unattributable as
  formality, and the hole reopens through them. **Reversed, and re-ruled by the
  owner on 2026-08-03: the field is deferred.** Literal reuse is an output
  property and literal influence is not, a verbatim-substring rule licenses
  fragments, and composed replies leave example text no position to occupy. See
  §11 decision 1.
- **A new save-time control is required**: `bannedWords` must refuse negations
  and function words. Nothing today stops a tenant banning `not` or `never`,
  and a span-faithful sentence rewritten to drop a banned negation passes every
  token check while inverting meaning. Containment is additive and cannot see
  deletion.

A prerequisite also surfaced that blocks implementation independently of this
ruling: the prompt template's scaffold strings must become a frozen versioned
artifact. Greetings, connectives and sign-offs come from the template rather
than from any span, so the v2 gate text was never literally satisfiable, and a
checker cannot separate a scaffold token from a smuggled one until the scaffold
vocabulary is pinned. That work precedes any conditioning work.

The unsafe-text screens this section originally asked for are now implemented in
`voice-profile.ts` and migration `0024`, so the residual word-list risk is
semantic recombination rather than syntactic smuggling. Recombination, deletion
and example-rewrite misuse are red-team fixtures, not gate logic;
`support-ai-boundary.md` §3.8 records them.
