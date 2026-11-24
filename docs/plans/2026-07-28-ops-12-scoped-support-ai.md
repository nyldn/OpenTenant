# OPS-12 scoped support AI implementation plan

Date: 2026-07-28

## Boundary

Implement the accepted `docs/product/support-ai-boundary.md` as local,
provider-neutral contracts. No provider SDK, network call, credential, genuine
tenant data, automatic ticket mutation, or publication route is introduced.

## Design

1. Add a support-module service whose only successful output is a reviewed
   suggestion. Ticket input is assembled from the frozen allowlist; internal
   notes and requester identity fields have no representation in its contract.
   Provider failure, budget exhaustion, disablement, empty retrieval, low
   confidence, and invalid output become explicit non-blocking outcomes.
2. Add an in-memory canonical knowledge contract for installation-owner shared
   and tenant-private articles. Drafts retain source provenance and redaction
   review. Publication is an explicit human action. Tenant-private promotion
   requires a different human reviewer and creates a new owner-shared record.
   Retrieval binds tenant scope from authority, never caller input.
3. Validate suggestion citations against the exact retrieved chunk and
   character span. Reject uncited claims or content outside cited spans. Persist
   content-free inference evidence with prompt digest, template version, input
   watermark, provider-policy reference, and outcome.
4. Add an offline evaluation harness whose suite manifest encodes the accepted
   minimum strata and paired-regression rules, while deterministic fixtures
   exercise privacy, prompt injection, tenant denial, human review, and failure
   behavior without a live model.

## Test-first sequence

1. Add public-entry tests for suggestion containment, non-blocking failure,
   cross-tenant denial, publication/promotion review, and evaluation thresholds.
2. Run the focused support test and record the expected missing-module failure.
3. Implement the smallest contracts needed by those tests and export them from
   `@opentenant/support`.
4. Run the focused support tests and direct package typecheck.
5. Update durable project records and set OPS-12 to `not_verified`; the
   controller owns full verification and completion.

Marketing classification: `truth` — capability and maturity facts change, but
no marketing page structure or copy is changed here.
