# Product requirement status

Date: 2026-11-17. Reconciled against `d818389`, the integrated wave-6
baseline. The September M3/GFinal reviews remain historical evidence for their
own revisions, not a current inventory of callable routes or persistence.

This ledger separates committed local behavior from product direction. It does
not claim production deployment, live model-provider validation, genuine tenant
data, or release approval. The [E11 receipt ledger](2026-11-17-e11-reconciliation.md)
records current counts, source revisions and limits. GitHub Actions is
billing-blocked; local/static gates supply no hosted CI receipts. KVM CI remains
owner-gated by OWNER-KVM-CI-01.

Current wave-7 UAT pass rate: **PENDING integrator receipts**. Current ECS:
**PENDING independent review and integrator receipts**. V3's six passing frozen
budget tests do not close UAT-015; Assessment still misses LCP/CLS targets. See
[the measured V3 record](../reviews/2026-11-17-wave6-v3.md).

## Status vocabulary

| Status | Meaning in this ledger |
| --- | --- |
| `implemented locally` | The accepted deliverable exists in committed source with a focused local test. Hosted or production proof may still be absent. |
| `foundation` | Reusable contracts, stores, adapters, or checks exist, but the requirement is not an end-to-end product path. |
| `partial` | An integrated path satisfies some accepted behavior and still misses named acceptance criteria. |
| `deferred` | Accepted work is intentionally outside the executable repair and integration queue. |
| `owner-gated` | The next action needs the specific authority recorded in `docs/OWNER-TASKS.md`. |

## Requirement sources and precedence

The initial import is commit `036ddc6`. Its Developer MCP PRD at
`docs/product/2026-07-19-tenant-module-developer-mcp-prd.md` became
[`docs/product/developer-mcp.md`](../product/developer-mcp.md). The accepted
[`Developer MCP authority freeze`](../product/developer-mcp-authority-freeze.md)
narrows that PRD for v1. In particular, publication is disabled and brokered
tenant-data or external-API capabilities are not part of v1.

The accepted Support AI boundary permits review-required suggestions. It does
not deliver the autonomous Support Agent described in
[`ai-support-agent.md`](../product/ai-support-agent.md). The accepted brand and
voice rulings keep preferred words, examples, and style fields inert unless a
later reviewed composition contract permits them. Lab Phase 0 landed in commit
`f2a8db9`; phases 1 through 4 remain deferred.

## Developer MCP, FR-001 through FR-015

The package contracts are composed into `/api/mcp/developer`, with local
OAuth/PKCE, human confirmation, durable authority/audit/admission and a real
microVM route proof. The [route receipt](../reviews/2026-11-17-developer-mcp-route.json)
is separate from the earlier provider lifecycle proof. OWNER-DEVELOPER-MCP-02
continues to gate production activation. No hosted sandbox, publication or
production enablement is claimed. The [runbook](../runbooks/developer-mcp.md)
owns operation of this bounded local path; the
[pre-exposure contract](developer-mcp-pre-exposure-contract.md) preserves its
earlier gap analysis.

| Requirement | Status | Current source and test evidence | Missing outcome |
| --- | --- | --- | --- |
| FR-001, authentication and tenant binding | `partial` | Local/Better Auth consent and PKCE, exact resource audience and opaque token checks are composed; the real route receipt proves exchange and denial controls | Hosted OAuth and production approval remain absent. |
| FR-002, permission and capability resolution | `partial` | Durable projects, frozen profiles, live tenant/member checks, confirmation, admission and independent kill switches guard `workspace.create` | This is one synthetic local tool, not the full catalogue or production authority. |
| FR-003, tenant-private workspace lifecycle | `partial` | Durable job records and one approved service-template creation path; real VM teardown before preview is receipt-backed | No full create/resume/export/archive product workflow. |
| FR-004, agent-readable platform resources | `foundation` | `packages/developer-mcp/src/tools.ts`, `catalog.ts`, `protocol.ts`, and `contracts.test.ts` freeze and filter the tool catalogue | No callable resource handlers or versioned resource delivery path. |
| FR-005, isolated code execution | `partial` | Real local route proof with digest-pinned cached image, KVM execution/destruction, empty guest environment and denied public/host egress | No hosted CI receipt or production-approved sandbox; the synthetic template proof does not authorize general untrusted execution. |
| FR-006, dependency and supply-chain handling | `foundation` | `packages/sandbox/src/template.ts` and `template.test.ts` pin an immutable synthetic template and lockfile; the orchestrator checks its digest | The publication validation bundle, registry policy, SBOM, licence, vulnerability, and immutable-lock enforcement are not assembled. |
| FR-007, brokered tenant data access | `deferred` | The v1 authority decision in `developer-mcp-authority-freeze.md` section 8 permits no genuine tenant data in a sandbox; `packages/database/src/module-capability-store.integration.test.ts` is separate platform foundation | Brokered Developer MCP data capabilities need a later accepted capability freeze and owner scope. |
| FR-008, brokered credentials and external APIs | `deferred` | The v1 authority decision and `docs/plans/2026-08-03-developer-mcp-route-enablement.md` section 1 specify no brokered capabilities | Destination, method, scope, credential custody, revocation, and connect-time egress controls belong to a later gated project. |
| FR-009, declarative infrastructure | `deferred` | `developer-mcp-authority-freeze.md` keeps `module.dev.infrastructure.approve` unassignable; `authority.test.ts` proves unassignable slugs are refused | No infrastructure plan, approval, apply, or rollback path is authorized. |
| FR-010, continuous validation | `partial` | Local `workspace.create` performs bounded `node --check` against the approved template and collects static preview evidence | No general validation handlers or immutable publication validation bundle. |
| FR-011, tenant-branded live preview | `partial` | Authenticated one-use static preview exchange after VM destruction; route proof covers replay/expiry/secret denial | This is a fixed synthetic snapshot, not a running tenant-branded application preview. |
| FR-012, publication proposal and approval | `deferred` | `packages/developer-mcp/src/slugs.ts` names publication permissions and `authority.test.ts` proves they are unassignable | The publication proposal and separation-of-duties design are not accepted or executable. |
| FR-013, deployment and module registration | `foundation` | `packages/database/src/module-ownership-store.ts` and its integration test cover tenant-private registration, assignment, promotion, and rollback-oriented records outside MCP | No approved remote publication path or Developer MCP deployment handler. |
| FR-014, audit, observability, and evidence | `partial` | PostgreSQL authorization audit, confirmation/job transaction and durable admission compose with the actual local route; negative controls are receipt-backed | No production operational receipt or optional outbox replication proof. |
| FR-015, revocation, disable, and rollback | `partial` | Route proof covers revocation, token/confirmation expiry, both kill switches and admission denial; execution has bounded deadlines | No production rollback or full published-module lifecycle. |

## Module Improvement Lab, FR-001 through FR-011

Phase 0 is `implemented locally` as a delivery phase. Commit `f2a8db9` added
`packages/quality-contract`, including six validated schemas, immutable digests,
weakening detection, and deterministic baseline-versus-candidate evaluation over
a synthetic module. That phase is evidence for the foundations below, not proof
that Observe, Propose, Experiment, or Governed reuse exists.

The accepted persistence design is
[`quality-contract-persistence.md`](quality-contract-persistence.md). It defines
immutable artifact bindings and evaluation evidence. E18 implements insert-only,
audited persistence and the wave-5 host factory checks authenticated tenant,
live permissions and trusted artifact bytes. The
[wave-5 receipt](../adopters/wave5-wiring-verification.md) records nine database
cases and the focused browser proof. There is no HTTP caller, Lab runner or
publication path; persistence does not complete Lab phases 1 through 4.

| Requirement | Status | Current source and test evidence | Missing outcome |
| --- | --- | --- | --- |
| FR-001, consent and signal policy | `deferred` | The accepted policy remains in `2026-07-19-module-improvement-lab-prd.md`; owner decisions remain in `docs/OWNER-TASKS.md` | No tenant consent, signal selection, or collection-preview path. |
| FR-002, privacy-preserving ingestion | `foundation` | `packages/quality-contract/src/schemas.ts` and `schemas.test.ts` allow only named evidence kinds and require purpose, redaction policy, and retention | No ingestion service, field removal, secret detection, or retention execution. |
| FR-003, evidence clustering | `deferred` | The requirement remains in the Lab PRD | No approved signal set, durable evidence store, clustering service, or inspection UI. |
| FR-004, hypothesis before implementation | `deferred` | The requirement remains in the Lab PRD; the quality contract can carry comparison metrics and guardrails | No hypothesis record or human Observe-to-Propose approval. |
| FR-005, isolated candidate generation | `foundation` | `packages/sandbox/src/orchestrator.ts` and tests prove a synthetic isolated candidate lifecycle; `packages/quality-contract/src/synthetic.ts` is synthetic-only | No Lab-to-Developer-MCP path, tenant-bound candidate record, or production-approved sandbox. |
| FR-006, baseline comparison | `partial` | Deterministic evaluation plus E18 durable contract/evaluation records bound to exact tenant-private artifact bytes and audited atomically | No Lab candidate runner supplies the full comparison workflow. |
| FR-007, human review | `foundation` | `packages/quality-contract/src/contract.ts` distinguishes platform and workspace ownership and reports contract weakenings for later review | No durable review bundle, reviewer action, or digest-bound approval. |
| FR-008, controlled experiment | `deferred` | The requirement and undecided limits remain in the Lab PRD and `docs/OWNER-TASKS.md` | No allocation adapter, approved limits, experiment records, or automatic rollback. |
| FR-009, publication and rollback | `deferred` | The Lab PRD depends on Developer MCP publication, which remains disabled | No experiment-winner proposal or release-gate composition. |
| FR-010, cross-tenant learning | `owner-gated` | `docs/OWNER-TASKS.md` leaves the value and governance of generic benchmark-pattern sharing undecided | No opt-in cohort, disclosure, provenance, or revocation mechanism. |
| FR-011, audit and revocation | `deferred` | `packages/quality-contract` produces deterministic digests but no Lab activity ledger | No durable Lab audit chain, consent-revocation processing, or deletion evidence. |

## AI Support Agent, phases P0 through P4

The committed `SupportAiService` is the narrower OPS-12 review-only support
assistant. It has knowledge scoping, citation checks, bounded provider failure,
human review, a frozen reply scaffold, banned-word refusal and inference metadata.
The accepted [review composition](support-ai-review-composition.md) now has
durable suggestion/review stores, ticket UI and review APIs. The
[wave-5 receipt](../adopters/wave5-wiring-verification.md) proves persistent
synthetic suggestions without automatic ticket mutation or sending. Routed
inference and encrypted rejected-output quarantine remain unavailable pending
the dependencies in [host configuration](../adopters/wave5-ai-wiring.md).
This is not the autonomous Support Agent or its P0 classification channel.

| Phase | Status | Current source and test evidence | Missing outcome |
| --- | --- | --- | --- |
| P0, triage only | `foundation` | `modules/support/src/support-ai-service.ts`, `support-ai-policy.ts`, and `support-ai.test.ts` cover review-required suggestions and safe failure; `docs/product/support-ai-boundary.md` is the accepted narrower contract | The review-only application journey exists; the separate ticket-only classification channel, injection-attempt telemetry and P0 red-team CI set remain absent. |
| P1, reproduction harness | `deferred` | `packages/sandbox` supplies reusable synthetic execution foundations only | No fixed test-template catalogue, out-of-band path resolver, or measured reproduction baseline. |
| P2, fix proposals | `deferred` | Developer MCP and quality-contract packages are prerequisites, not a Support Agent proposal path | No ticket-isolated fix agent, immutable generated test, category-scoped diff gate, or review bundle. |
| P3, staging release | `deferred` | The accepted PRD requires P2 evidence first | Module publication is disabled and no automated staging release or injected-failure rollback proof exists. |
| P4, tenant opt-in resolution | `owner-gated` | `ai-support-agent.md` sections 9 and 12 require P3 rollback evidence and owner sign-off before T3 | Liability, disclosure, exact change classes, production authority, and operating evidence remain unresolved. |

## Accepted brand and voice deliverables

| Deliverable | Status | Current source and test evidence | Missing outcome |
| --- | --- | --- | --- |
| Deterministic `brand.md` parsing and input limits | `implemented locally` | `packages/platform-core/src/brand-document.ts`, the bounded platform upload handler and their tests cover byte, encoding, media, key and recognized-value limits before transactional persistence | None for the accepted local parsing boundary. |
| Upload provenance and immutable parser version | `implemented locally` | The upload transaction and typed page read model persist and display source kind, original SHA-256 digest, parser version and upload attribution without raw content; unit and PostgreSQL tests cover URL and upload sources | None for the accepted local projection. |
| Proposal review, provenance-preserving edit, discard, and apply | `implemented locally` | `packages/database/src/brand-proposal-store.ts`, the platform route and the tenant administrator page compose the explicit actions with transaction, lock, race, policy and audit tests | Hosted role assignment remains owner-scoped. |
| Duplicate upload and draft supersession semantics | `implemented locally` | The platform upload transaction composes the accepted digest and supersession rules, including duplicate and race proofs against PostgreSQL | None for the accepted local transaction. |
| Six tenant-bound brand proposal permissions | `implemented locally` | `packages/auth/src/brand-proposal-authority.ts` and its tests define the closed permission contract. The admin route derives upload and supersede separately; the store refuses replacement within the tenant-serialized transaction when supersede authority is absent. | Hosted role assignment still needs the owner decision recorded in `docs/OWNER-TASKS.md`. |
| `brand.md` upload-to-review application journey | `implemented locally` | The administrator page supports bounded file upload, typed provenance, locked-field rejection, edit, review, discard and apply. Browser evidence covers invalid recovery, keyboard upload, durable draft creation, review, apply, resulting branding, responsive widths and server authorization denial | Production identity/database configuration and deployment remain owner-scoped. |
| Structured, immutable tenant voice profile | `implemented locally` | `packages/platform-core/src/voice-profile.ts`, `packages/database/src/tenant-voice-profile-store.ts`, migration `0024`, and their unit and migration tests | No operator-facing profile form is claimed. |
| Unsafe rewrite screening and meaning-bearing banned-word denial | `implemented locally` | `voice-profile.test.ts`, migration `0025`, `voice-profile-unicode.test.ts`, and `control-plane-meaning-bearing-bans.integration.test.ts` test code/database parity | None for the accepted storage and validation boundary. |
| Banned-word enforcement in review-only suggestions | `implemented locally` | `modules/support/src/support-ai-policy.ts`, `support-ai-service.ts`, and `support-ai.test.ts` reject a rendered reply containing an applied banned word | This does not authorize automatic replies. |
| Voice-profile inference watermark | `implemented locally` | Suggestion persistence and host voice composition pin the verified applied profile version/digest; wave-5 database/browser receipts cover review-only composition | Routed inference provenance and rejected-output quarantine remain disabled dependencies. |
| Preferred-word conditioning | `deferred` | `support-ai-boundary.md` section 3.8 records the sanctioned exact-match rule; the stored field is intentionally inert | A separate composed-reply proposal and evidence must define where a preferred word can enter without weakening provenance. |
| Example rewrites and five style fields | `deferred` | `brand-and-voice-documents.md` section 11 and `support-ai-boundary.md` section 3.8 require the fields to stay stored and inert | Any customer-facing use needs a new accepted gate. |
| Extended cross-border consent for brand and voice content | `partial` | `packages/platform-core/src/model-routing.ts` and tests enforce versioned consent generally; the voice inference record pins profile evidence | Typed routing composition and synthetic adapter contracts exist; live provider validation and the missing Support inference provenance remain unproven. |

## Historical September coordination ledger

All implementation packets registered in
[`unattended-backlog.json`](unattended-backlog.json) set `executionMode` to
`"supervised"`. The controller schema has no model field. The coordinator
assigns the models below through the host and records the actual model and effort
in task evidence.

| Milestone | Tasks | Assigned model and effort |
| --- | --- | --- |
| M1 | `OT-R01`, `OT-R04`, `OT-R05`, `OT-R06` | `gpt-5.6-sol`, `high` |
| M1 | `OT-R02`, `OT-R03` | `gpt-5.6-luna`, `high` |
| M2 | `OT-I01`, `OT-I02`, `OT-I03` | `gpt-5.6-sol`, `high` |
| M2 | `OT-I04`, `OT-I05` | `gpt-5.6-luna`, `high` |
| M3 | `OT-D01`, `OT-D02`, `OT-D03` contract authorship | `gpt-5.6-sol`, `high`; Luna owns the bounded UI follow-ons |
| Milestone and final review | Fixed candidate revision after deterministic checks | `gpt-6-astra`, `high` |

The coordinator must obtain Astra's contract review of `OT-I01` before starting
`OT-I02`. `OT-I05` starts only after Sol and Astra accept its versioned-document
conversion contract. These review gates stay in coordination evidence because
the controller dependency schema represents task IDs, not reviewer decisions.

The backlog does not register `OT-D01` through `OT-D03`. Those packets produce
designs and leave product work deferred; registering them as executable code
tasks would overstate their authority.
