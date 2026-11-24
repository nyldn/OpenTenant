# OT-I05 engagement persistence contract

Date: 2026-09-06

Status: candidate for Astra review before Luna implementation

## Decision

OT-I05 will replace the three unscoped Assessment storage paths with one
versioned, tenant-scoped engagement document. The live provider will use
`AssessmentRepository` for every load, save, import, export and clear operation.
It will not read or write `localStorage` directly.

The storage key and the document both carry the tenant ID supplied by the
server-rendered platform page. Browser input, a query parameter, a prior stored
document and a passcode principal cannot select that tenant ID. Assessment
documents remain owned by the browser profile. This is true in identity mode
and passcode mode. In particular, passcode mode does not create a durable user
ID or partition documents by the signed passcode principal.

Unscoped legacy data has no provable tenant owner. The application must not
attach it to whichever tenant happens to load first. It may convert that data
only after an authorized user explicitly claims it for the current
server-supplied tenant. The claim is content-neutral until the choice is made,
pins all observed legacy source digests to that tenant, and never deletes the
source blobs. This is the fail-safe answer to the packet's legacy-ownership
question.

No standalone Assessment PRD exists in this checkout. This contract therefore
uses the accepted example-module boundary in
`docs/architecture/platform-architecture.md`, the current module behavior, the
September code review and the OT-I05 packet. It does not infer server-side
engagement storage, user ownership or a new sharing model.

## Canonical engagement document

The next schema version is `2`. The document has this exact shape. Schema
validation rejects additional keys at every level so a future shape requires a
new version and converter.

```ts
interface EngagementDocumentV2 {
  schemaVersion: 2
  appVersion: string
  tenantId: string
  engagementId: string
  brandLabel: string | null
  session: {
    clientInfo: {
      name: string
      department: string
      operatingProfile: "" | "professional_services" | "financial_services" |
        "manufacturing" | "public_sector"
      date: string
      facilitator: string
    }
    scores: Record<string, number>
    evidence: Record<string, string>
    currentPillar: number
  }
  respondents: Array<{
    id: string
    company: string
    department: string
    operatingProfile: "" | "professional_services" | "financial_services" |
      "manufacturing" | "public_sector"
    name: string
    role: string
    timestamp: string
    scores: Record<string, number>
    evidence: Record<string, string>
  }>
  legacyClaim: null | {
    claimId: string
    source: "v26" | "engagement_v1"
    sourceDigests: {
      assessment_session_v26: string | null
      assessment_respondents_v26: string | null
      assessment_engagement_v1: string | null
    }
  }
  readout: null | {
    text: string
    generatedAt: string | null
    inputDigest: string | null
  }
  createdAt: string
  updatedAt: string
}
```

The fields map to current behavior as follows.

- `session` is the complete live `AssessmentSession`. The opaque v1
  `sessionState` field is retired.
- `respondents` contains the complete records used by the roster,
  consolidation, editing and exports. V2 makes the three formerly optional
  client-context fields required and uses `""` when a legacy record omitted
  them.
- `readout` stores only a completed result. Loading, error and cancellation are
  transient UI states.
- `legacyClaim` is `null` for a new document and for an ordinary saved document.
  The pinned conversion target repeats the claim identity and all observed
  source digests so it cannot become readable before the origin-wide claim
  receipt is complete. The first later user edit clears this marker through the
  completed-claim transition defined below.
- `brandLabel` is an informational snapshot. The platform still supplies the
  active tenant brand at render time.
- Dashboard values and priorities are derived. They do not belong in the
  restorable document.
- Respondent edit identity and the pre-edit session are transient. A reload
  cancels an unfinished edit rather than persisting a half-open editing mode.

New engagements use a locally generated `engagementId`, the current
`ASSESSMENT_VERSION`, the active brand display name, and canonical UTC
timestamps. Updating progress changes `updatedAt` but does not affect readout
freshness.

## Validation and canonicalization

All parsing starts from `unknown`. Validation constructs a new canonical value
instead of returning the input object. The same validator runs before save,
after storage readback, on import, and after every legacy conversion.

The implementation should centralize these bounds so tests do not duplicate
magic numbers.

| Value | Accepted form |
| --- | --- |
| Serialized document | At most 1 MiB of UTF-8 before `JSON.parse` |
| `schemaVersion` | The integer `2` only |
| `appVersion` | An ASCII token matching `[A-Za-z0-9][A-Za-z0-9._+-]{0,63}` |
| `tenantId` | A non-empty opaque string of at most 128 code points; it must equal the trusted runtime tenant exactly |
| `engagementId` | A non-empty string of at most 128 code points |
| `brandLabel` | `null` or at most 256 code points |
| Client name, department and facilitator | Strings of at most 256 code points |
| Operating profile | `""` or one of the four values rendered by `OPERATING_PROFILES` |
| Assessment date | `""` or a real calendar date in `YYYY-MM-DD` form |
| Score maps | A subset of the 25 keys built from `PILLARS`; each value is an integer from 1 through 5; unscored dimensions are absent |
| Evidence maps | A subset of the same 25 keys; each value is a string of at most 8,192 code points |
| `currentPillar` | An integer from `0` through `PILLARS.length + 1`, including Responses and Results |
| Respondents | At most 500 complete records with unique IDs |
| Respondent ID | A non-empty string of at most 10,240 code points |
| Respondent name, role, company and department | Strings of at most 256 code points; name must contain a non-whitespace code point |
| Respondent timestamp and document timestamps | Canonical UTC ISO strings; `createdAt` must not be later than `updatedAt` |
| `legacyClaim` | `null` or the exact claim shape; `claimId` uses the engagement-ID bound, the source is one allowed literal, and every present digest matches `sha256:[0-9a-f]{64}` |
| Readout text | A non-empty string of at most 131,072 code points |
| Readout binding | Both fields are `null` for a recovered unbound readout, or `generatedAt` is canonical UTC and `inputDigest` matches `sha256:[0-9a-f]{64}` |

String values preserve user spacing and punctuation. Validation must not turn a
bad value into a plausible value by calling `String(value)`. Canonical document
construction may omit empty evidence entries, but import must accept valid
empty strings because the current UI can persist them. Non-finite numbers,
arrays in place of maps, inherited values, unknown dimension keys and duplicate
respondent IDs are invalid.

The total byte limit is the final bound. A legacy source that exceeds a field,
count or byte limit remains available as a raw recovery backup but is not
rendered or partly imported.

The larger respondent ID limit is intentional. The current generator percent
encodes the normalized company, department and respondent name into one `v2:`
ID. Three 256-code-point non-BMP values can produce more than 9,200 ASCII
characters before the duplicate suffix. The 10,240 limit accepts that current
output and the suffixes possible with 500 respondents. OT-I05 does not replace
the ID algorithm. Existing encoded and name-only legacy IDs within the document
bounds survive load and edit. Matching by normalized company, department and
name still updates the matched record, edits keep the original ID, and the
existing legacy-name upgrade and collision suffix behavior remain unchanged.

## Readout binding and staleness

`READOUT_INPUT_VERSION` starts at `1`. Code must bump it whenever scoring,
benchmark, priority or summary construction changes in a way that can change a
readout without changing saved inputs.

Before a request, the client constructs a canonical readout-input object with:

- `READOUT_INPUT_VERSION` and the benchmark version;
- all five client fields;
- active scores and evidence in the fixed `PILLARS` dimension order;
- every respondent field, score and evidence value, with respondents sorted by
  ID for hashing.

It hashes the UTF-8 canonical JSON as SHA-256 and records the value as
`sha256:<lowercase hex>`. The digest excludes progress, document timestamps,
brand presentation and the readout itself.

A stored readout is current only when its non-null `inputDigest` equals the
digest of the active inputs. Any client detail, score, evidence or respondent
change therefore makes the prior text stale. Canceling a respondent edit can
make it current again when the exact prior inputs return. Progress navigation
alone does not make it stale.

Results must not start a model request on mount. A restored current readout is
shown without a call. A stale or unbound readout remains visible with a plain
stale label and an explicit Regenerate action. PDF generation may include only
a current readout. The deterministic report remains complete when no current
readout exists.

Generation captures the input digest before the request. Streamed text is only
a preview until the done terminal arrives. A successful terminal replaces the
stored readout only if the current digest still matches the request digest. An
abort, transport failure, provider failure, malformed stream or input change
during generation leaves the previous stored readout unchanged. No partial
text is persisted.

A v1 readout has no trustworthy input binding. Conversion preserves its text
with both binding fields set to `null`, which makes it recoverable and always
stale until the user regenerates it.

## Repository and save behavior

The trusted runtime supplies `{ tenantId }` to the repository. The v2 keys are:

```text
assessment_engagement_v2:<encodeURIComponent(tenantId)>
assessment_engagement_v2:<encodeURIComponent(tenantId)>:backup
assessment_engagement_v2:<encodeURIComponent(tenantId)>:recovery:<sha256hex>
assessment_legacy_claim_v1
assessment_legacy_claim_v1:target:<claimId>
```

The active document repeats `tenantId`. A key match without an embedded tenant
match is invalid. Import also rejects a document for another tenant before any
write. OT-I05 does not add a cross-tenant copy workflow.

`load()` must distinguish `empty`, `ready`, `invalid`, `legacy_available`,
`legacy_claim_pending` and `legacy_claimed_elsewhere`. Claim results add
`legacy_exclusion_unavailable`. Returning `null` for all failures is too lossy.
The provider renders only `ready` data. Recovery states show bounded messages
and never include stored content in logs or errors.

The provider must finish the asynchronous repository load before enabling
autosave. It must not paint an empty state and overwrite a valid document while
hydration is pending. A tenant-context change remounts the provider and creates
a new repository before any state from the prior tenant can render or save.

Load precedence is fixed. A malformed active value returns `invalid`; the
repository does not silently fall back to a backup or legacy source. A valid
active document with `legacyClaim: null` returns ready unless the current tenant
has a pending receipt, which makes that different active value a blocked claim
conflict. A valid claim-backed document goes through the complete-receipt checks
below before it can return ready. A receipt owned by another tenant does not
block an existing marker-free document under the current tenant's scoped key.
Only an absent active key allows legacy discovery or an empty result. Restoring
a rolling backup always requires an explicit user action.

When the active key is absent, the repository validates the receipt before it
reports legacy availability. A matching pending receipt returns
`legacy_claim_pending`; a receipt for another tenant returns
`legacy_claimed_elsewhere`; a complete receipt without its matching active
document and a malformed receipt both return `invalid`. Only a missing receipt
allows fresh legacy discovery.

Every operation that can replace or remove the active key first records whether
that key exists and, when it does, its exact raw DOM string. The recovery digest
is SHA-256 over the string's UTF-8 bytes. Valid prior data goes to the tenant
backup key. Malformed prior data goes to the digest-addressed recovery key. The
repository compares the recovery readback with the original string and compares
its digest before it touches the active key. If it cannot preserve and verify
the exact prior value, the operation stops. This rule applies to ordinary save,
repair, restore, import and clear.

Each replacement follows this order:

1. Canonicalize and validate the candidate.
2. Snapshot and verify the exact prior active value as described above.
3. Write the candidate to the active key.
4. Read it back, compare the exact serialized value, validate it again and
   check the tenant binding.
5. Report saved only after all checks pass.

If snapshot, active write or readback fails, return a bounded storage failure.
Rollback uses the operation's recorded prior state, not whatever happens to be
in the rolling backup key. If an active value existed, restore that exact raw
string and verify equality and digest. If no active value existed, remove the
new active key and verify absence. An older backup can belong to an engagement
cleared earlier, so it must never be restored into a previously absent slot.

Keep unsaved in-memory edits visible and leave every verified backup or recovery
snapshot available. A retry is explicit. Never describe blocked storage as
autosaved. `clear()` snapshots the exact active value, removes only the active
tenant key and verifies absence. A failed clear restores the recorded active
value. It does not remove another tenant's key, the tenant backup, recovery
snapshots, legacy data or a legacy claim receipt.

## Legacy claim, conversion and recovery

The repository recognizes these unscoped sources:

```text
assessment_session_v26
assessment_respondents_v26
assessment_engagement_v1
```

It computes a SHA-256 digest of every present raw value. It may report that a
source exists, but it must not parse content into provider state, show client or
respondent fields, or auto-convert before a claim.

The recovery UI asks whether to claim the browser's legacy Assessment data for
the current tenant. If both the live v26 pair and the repository v1 document
exist, the user chooses the source by neutral labels. The UI does not preview
either source.

Claim mutation requires the origin-wide Web Lock named
`opentenant:assessment:legacy-claim:v1` in exclusive mode. The repository takes
the Web Locks implementation as a dependency so tests can control competing
tabs. It does not substitute an in-process mutex, a storage event or a
read-then-write check. If Web Locks is unavailable, lock acquisition fails, or
the callback cannot run, claiming fails closed as
`legacy_exclusion_unavailable`. No receipt, source or tenant document changes.

The receipt has one exact schema:

```ts
interface LegacyClaimReceiptV1 {
  schemaVersion: 1
  claimId: string
  tenantId: string
  source: "v26" | "engagement_v1"
  sourceDigests: {
    assessment_session_v26: string | null
    assessment_respondents_v26: string | null
    assessment_engagement_v1: string | null
  }
  status: "pending" | "complete"
  targetDocumentDigest: string | null
  createdAt: string
  updatedAt: string
}
```

All non-null digests match `sha256:[0-9a-f]{64}`. A complete receipt requires a
target digest. The validator enforces the same tenant, identifier and timestamp
bounds as the engagement document, exact keys, an allowed source, canonical UTC
timestamps and `createdAt <= updatedAt`. Selecting `v26` requires at least one
of its two source digests. Selecting `engagement_v1` requires that source's
digest. A malformed receipt blocks the claim and any claim-backed document load.
The application never repairs or replaces a receipt by guessing. A complete
receipt is immutable. The target key is derived from `claimId`; its value is the
exact serialized conversion target, not another JSON wrapper. Once the receipt
has a non-null target digest, that target value is immutable too.

The exclusive callback performs the whole claim sequence:

1. Re-read and strictly validate the receipt, then re-read every source value
   and digest while the lock is held.
2. Reject a receipt for another tenant, different source choice or different
   source digests. A matching pending receipt owned by the current tenant may
   resume.
3. Write and verify a pending receipt. At first it has a null target digest, so
   even malformed source data becomes exclusively pinned to the chosen tenant
   before raw recovery is offered.
4. Parse and convert the selected source. Create the conversion identity and
   timestamps once. Write the exact canonical v2 target to the derived target
   key, then verify its raw readback, schema, claim fields and SHA-256 digest.
5. Update and verify the pending receipt with that target digest. The target is
   now pinned. No retry may generate a new engagement ID, timestamp, app version,
   brand snapshot, serialized document or digest.
6. Copy the exact pinned target value to the tenant active key through the
   normal replacement path and verify it. Do not reserialize it.
7. Change only the receipt status and `updatedAt` to complete, then verify the
   exact receipt readback.
8. Re-read the active document and receipt. Return ready only when the active
   digest equals the complete receipt's target digest and every claim field
   matches.

A pending receipt reserves all observed sources for one tenant across tabs.
Another tenant receives only `legacy_claimed_elsewhere` and cannot claim,
preview, convert or download those values through the Assessment UI. Two
simultaneous first claims serialize inside the lock. The first verified pending
receipt wins, even if its conversion later fails. The second callback must
re-read that receipt and deny a different tenant.

A pending claim uses this exact recovery table while the exclusive lock is
held:

| Receipt target | Active key | Required action |
| --- | --- | --- |
| Unset | Absent | If the immutable target key is absent, convert once and write it. If the target key already exists after an interrupted write, validate its claim fields and pin its exact digest. |
| Unset | Present | Return a conflict and preserve the active value. There is no pinned digest that can prove the active value is the conversion target. |
| Pinned | Absent | Require the immutable target key to match the pinned digest, then copy those exact bytes to active and verify them. |
| Pinned | Exact target | Verify the immutable target key and active value, then complete the receipt without rewriting either document. |
| Pinned | Any different value | Return a conflict and preserve the active value. Do not back it up, overwrite it, regenerate the target or complete the receipt. |

Once the target digest is pinned, retries use the stored target bytes. They
never rerun conversion or regenerate identity, metadata or timestamps. A missing
or mismatched immutable target key, changed source digest, malformed receipt or
unavailable exclusion blocks recovery without showing content.

A claim-backed v2 target is not independently ready. While the receipt is
pending, `load()` always returns `legacy_claim_pending`, even when active equals
the pinned target. A missing, malformed or mismatched receipt returns `invalid`.
This rule closes the interruption between a successful active save and failed
receipt completion.

After the receipt is complete, an exact active target may render. The receipt
and immutable target then become migration evidence, not a digest lock on the
working engagement. The first successful ordinary mutation writes the exact
claim target to the rolling tenant backup, sets `legacyClaim` to `null` in the
new active document, and uses the normal save and rollback rules. Later saves,
exports and imports treat that marker-free document like any other v2
engagement. They do not alter the receipt or immutable target.

An engagement-backup export taken before that first mutation returns a validated
marker-free copy of the completed target. It keeps the same engagement data and
tenant binding but sets `legacyClaim` to null, so restore does not depend on an
origin-local receipt. Export does not change active storage, the receipt or the
immutable target. Importing that backup follows the ordinary v2 replacement
path.

A document with non-null `legacyClaim` remains valid only when its exact digest
matches the immutable target and complete receipt. Restore and import may put
that exact target back into active, after which it may render and transition on
the next edit. They reject a modified document that still carries the claim
marker. A marker-free backup restores through the normal tenant-bound v2 path.

For the v26 pair, each present blob must pass strict field validation. A missing
session becomes the empty session and a missing respondent list becomes an
empty list. Both missing means there is no candidate. A malformed present blob
blocks conversion of the pair, so the application never imports half of a
corrupt pair. The converter supplies required empty respondent context fields,
generates the v2 engagement metadata and sets `readout` to `null`.

The v1 converter supports these exact `client` and `sessionState` forms:

```ts
interface EngagementV1Client {
  name: string
  department?: string
  operatingProfile?: string
  date?: string
  facilitator?: string
  [legacyMetadata: string]: unknown
}

type EngagementV1SessionState =
  | undefined
  | null
  | { currentPillar: number }
  | {
      clientInfo: {
        name: string
        department: string
        operatingProfile: string
        date: string
        facilitator: string
      }
      scores: Record<string, number>
      evidence: Record<string, string>
      currentPillar: number
    }
```

The converter ignores unknown top-level `client` metadata because v1 explicitly
allowed it, but never copies that metadata into v2. All recognized values pass
v2 field validation. `client.name` is required. The other four client fields
default to `""`. Missing or null `sessionState` uses that client-derived record,
empty active scores and evidence, and pillar `0`. The minimal session form
changes only the pillar. This means a v1 document without a typed session still
restores `client.name` rather than becoming an unnamed assessment.

For the full session form, the session's active scores, evidence and pillar win
because v1 has no other active-session maps. Client values merge one field at a
time. A non-empty full-session value and a non-empty recognized top-level client
value must match exactly. A mismatch blocks conversion. An empty or absent
value yields to the non-empty value, and both empty yields `""`. Unknown keys in
either supported session form make that form invalid.

V1 top-level `scores` is the per-respondent index described by the existing
schema, not the active score map. Its keys must exactly equal the respondent
IDs. For each respondent, an empty embedded score map takes the indexed map. A
non-empty embedded map must equal the indexed map after canonical key ordering;
a mismatch blocks conversion. The converter uses embedded respondent evidence
because v1 has no second evidence index. It supplies `""` for absent legacy
company, department and operating profile fields. Respondent IDs and all other
respondent fields still pass v2 bounds.

V1 `createdAt`, `updatedAt`, `appVersion`, `engagementId` and `brandLabel` carry
forward after v2 validation. A non-empty `generatedReadout` becomes an unbound
stale readout with both binding fields null. Null or empty readout becomes null.
Unsupported session shapes, invalid recognized fields, score-index differences
and client conflicts stop conversion rather than choosing a convenient value.

The three source values and the claim receipt are never removed by automatic
conversion, import, clear or rollback. A user who has claimed the sources for
the current tenant may explicitly download each exact raw blob for recovery.
Malformed tenant-scoped v2 data remains untouched until the repository has
written and verified its digest-addressed recovery copy. Restoring the last
verified tenant backup or importing a repaired v2 document requires a separate
explicit action and full validation before provider state changes.

## Report and restorable formats

The existing CSV, PDF and report JSON remain reports. `buildAssessmentJson`
keeps its current `clientInfo`, derived `dashboard`, derived `priorities` and
complete `respondents` content. The UI label becomes "Export report JSON" so it
cannot be mistaken for a backup. Report JSON is not accepted by restore.

A separate "Download engagement backup" action exports the verified canonical
v2 document. A separate "Restore engagement backup" file input accepts JSON,
checks the byte limit, validates the complete document and enforces the current
tenant binding before writing. The filename identifies the format and schema,
for example `..._engagement-v2.json`. Invalid input, a report JSON file, an
unsupported version, a tenant mismatch or a storage failure leaves both the
current in-memory state and active stored document unchanged.

Import first backs up the current verified document, then saves and reads back
the imported document. The provider swaps state only after repository success.
The import control is disabled in demo mode. Report downloads may remain
available in demo mode as clearly synthetic output, but demo state cannot be
saved, restored, claimed or exported as an engagement backup.

## Provider behavior

The real state and respondent roster hydrate from one v2 document. Every real
state mutation schedules a repository save through one serialized queue so an
older asynchronous write cannot land after a newer one. The saved `updatedAt`
belongs to the mutation snapshot being written.

Demo state remains a separate in-memory session and roster. Entering demo mode
does not save, clear or import real state. Leaving it restores the hydrated real
state. Tenant switching during demo still remounts the provider, preventing the
prior tenant's real or demo values from flashing in the new context.

The current New action continues to reset the active session while preserving
the respondent roster, because Clear all responses is a separate existing
action. Resetting client fields, scores and evidence makes any stored readout
stale. Removing, clearing, adding or editing respondents does the same.

## Required implementation checks

Luna should write failing tests first for each group below.

### Schema and repository

- Exercise every field and bound in the validation table, including exact
  object keys, invalid dates, non-finite scores, unknown dimensions, duplicate
  respondents, malformed readout bindings, malformed legacy-claim fields and a
  document over 1 MiB.
- Generate current respondent IDs from 256 ASCII code points in each identity
  field and again from 256 non-BMP Unicode code points. Prove both pass the v2
  ID bound. Cover the duplicate suffix, legacy name-only upgrade, renamed-record
  collision and edit-by-original-ID behavior at those limits.
- Round-trip a v2 document with all client fields, active evidence, progress,
  respondent evidence and a bound readout.
- Prove tenant A and tenant B use different keys on one storage object. Tenant B
  must not load tenant A, and a tenant A backup import into tenant B must fail
  before `setItem`.
- Inject exceptions and mismatched readback for backup, malformed recovery
  copy, active save, repair, restore, import, clear and claim receipt writes.
  Prove exact malformed v2 raw bytes and their digest are verified before any
  overwrite. When the prior active key was absent, a failed write must restore
  absence even if an unrelated rolling backup exists. When it was present,
  rollback must restore its exact raw value. Errors must not contain content.
- Prove an invalid active document reports recovery instead of becoming an
  empty autosave target. Repair and import must refuse to overwrite it when the
  exact recovery copy cannot be written or read back.
- Prove unscoped data never auto-converts. Cover an explicit v26 claim, a v1
  claim with an unbound readout, every supported v1 `sessionState` form, client
  defaults, client/session conflicts, score-index conflicts, one missing v26
  blob and one corrupt present blob. Assert all raw legacy keys remain
  byte-for-byte unchanged.
- Run two tenant claims against one controllable Web Lock and shared storage.
  Prove only the first callback can create the pending receipt and the second
  tenant is denied after its inside-lock read. Withhold the lock implementation
  and prove no mutation occurs.
- Interrupt after the claim-backed v2 save but before the complete receipt
  readback. A normal load must not return ready. Exercise every pending-retry
  table row, including target unset with active absent or present, and target
  pinned with active absent, exact or conflicting. Once pinned, assert exact
  reuse of the immutable target bytes and stable engagement identity, metadata,
  timestamps and digest. A malformed receipt, missing target copy, changed
  source digest, different tenant or conflicting active value remains blocked
  and preserved.
- Complete a claim, edit it, save and reload. Assert the ordinary saved document
  has `legacyClaim: null`, the completed receipt and immutable target are
  unchanged, and the edited state is ready. Restore the rolling backup of the
  exact claim target, reload it through the receipt, edit again and prove the
  normal transition repeats. Round-trip a later marker-free backup through
  restore as an ordinary v2 document.
- Export the exact completed target before its first edit. Assert the downloaded
  engagement has `legacyClaim: null`, imports without the origin claim receipt,
  and round-trips without changing the immutable receipt or target copy.

### Store and results behavior

- Prove initial hydration cannot save an empty document over a stored one and
  that queued writes commit in mutation order.
- Reload every session field, progress, respondents and evidence. Prove an
  unfinished respondent edit is not restored.
- Render a restored current readout without calling `streamReadout`. Change each
  client field, an active score, active evidence and each respondent payload
  category, then assert the stale label. Progress-only navigation stays current.
- Prove regeneration requires a click. A successful done terminal replaces the
  prior text only for the captured digest. Failure, abort, malformed completion
  and an input edit during streaming preserve the prior recoverable text.
- Prove PDF receives only current readout text.
- Prove demo entry, edits, readout attempts, imports and tenant switches do not
  write real engagement state.

### Exports, platform and browser

- Keep the existing report JSON object and CSV content assertions. Add distinct
  report and engagement filenames, and reject report JSON in restore.
- Test the platform page and mount pass only the tenant resolved on the server.
  No client prop, stored value or passcode principal may replace it.
- In the synthetic browser app, save tenant A, switch to tenant B on the same
  origin, confirm an empty tenant B state, then return to tenant A and confirm
  exact restoration. Repeat the load path through passcode access.
- Download and parse both JSON formats. Restore the engagement file after a
  visible change, verify respondent evidence and progress, and prove an invalid
  import leaves the visible state untouched.
- Restore a current readout and inspect that no model request occurs. Edit an
  input, observe the stale treatment, regenerate explicitly, then reload the
  replacement.

Run the Assessment and platform test suites, the full Node 22 gates, the
uncached platform build, `git diff --check`, and the browser acceptance at the
exact candidate revision. OT-I05 changes public Assessment controls and status
treatment, so its marketing classification remains `content`. No marketing
repository acknowledgement belongs in this local task.

## Inspected sources

- `AGENTS.md`, `RTK.md`, `docs/HANDOFF.md`, `docs/README.md`
- `docs/architecture/platform-architecture.md`
- `docs/product/platform-capabilities.md`
- `docs/plans/2026-09-06-code-review.md`
- `docs/plans/2026-09-06-implementation-program.md`
- `docs/plans/2026-09-06-implementation-packets.md`
- `docs/plans/2026-09-06-agent-review-contract.md`
- `modules/assessment/src/README.md`
- `modules/assessment/src/types.ts`, `engine.ts`, `respondents.ts`, `sample.ts`
- `modules/assessment/src/store.tsx`, `runtime.ts`, `ai.ts`
- `modules/assessment/src/assessment-shell.tsx`
- `modules/assessment/src/assessment-questionnaire.tsx`
- `modules/assessment/src/assessment-responses.tsx`
- `modules/assessment/src/assessment-results.tsx`
- `modules/assessment/src/assessment-exports.ts`, `pdf.ts`
- `modules/assessment/src/persistence/engagement-schema.ts`
- `modules/assessment/src/persistence/assessment-repository.ts`
- The corresponding Assessment schema, repository, store, runtime, transport,
  export, respondent, engine, PDF and UI contract tests
- `apps/platform/app/assessment/page.tsx`, `assessment-mount.tsx`, `layout.tsx`
- `apps/platform/app/assessment/layout.test.tsx`
- `apps/platform/lib/assessment-access.ts`
- `apps/platform/app/access/assessment/page.tsx`

Graphify was queried before source exploration. Source files supplied the exact
field and behavior evidence where the graph summary was broader than this
contract.
