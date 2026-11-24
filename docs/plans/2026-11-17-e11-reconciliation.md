# E11 documentation reconciliation

Date: 2026-11-17. Source baseline: `d818389`, `t3/wave6`.
Scope: documentation only. Marketing impact: none. This corrects summaries of
already committed behavior and evidence; it adds no capability or availability.

## Receipt-backed corrections

Counts below describe their recorded revision and command. They are not new
wave-7 test results. Listing proves collection, not browser execution. The
database sequence, full migration suite and Developer MCP package overlap;
their counts must not be added together as a total.

| Stale summary | Correct reading | Committed receipt |
| --- | --- | --- |
| README's 63/63 tasks, 18 tenant tables and 183 isolation checks | V1 records 115/115 quality tasks and 406 RLS checks across 41 tables. No new aggregate unit-test total is claimed. | [V1 inventory and local verification](../../tooling/ci/db-sequence-inventory.md) |
| README's isolated admission 5 / exact-usage 4 snapshots treated as the current inventory | Retired those command-specific totals. The current sequence inventory names admission 3 and usage 2 cases within its 358-case scope, not replacement totals for every package test. | [V1 family inventory](../../tooling/ci/db-sequence-inventory.md) |
| Older database sequence and migration totals | V1 executes 17 sequence steps, 358 cases, zero skips; the separate full migration run passes 178 with zero failures/skips. | [V1 inventory](../../tooling/ci/db-sequence-inventory.md) |
| Historical 11/8/1 browser collections or nineteen journeys treated as current | At `d818389`, listing is legacy 16, Better Auth journeys 41, reset 24, audit 702; production lists separately with 6. These are collection counts. The earlier full 702-cell audit permitted baseline defects. | Commit `d818389` verification body; [B0 executed audit and limitations](../../tooling/e2e/audit/verification-2026-11-16.md) |
| Static-page count presented as route coverage | A Next build page count does not inventory module-manifest dispatch. Brain registers `/brain` and `/api/mcp/brain`; Support registers `/support`, `/support/:id` and its APIs. | [Brain manifest](../../modules/brain/src/manifest.ts), [Support manifest](../../modules/support/src/manifest.ts), [wave-5 browser receipt](../adopters/wave5-wiring-verification.md) |
| Developer MCP is package-only with zero successful routes, or only a separate provider proof exists | A real local route proof covers OAuth/PKCE, tenant authority, explicit human confirmation, VM execution/destruction, single-use static preview and negative controls. The separate Nov 14 provider proof remains evidence for its own scope. Production stays disabled behind OWNER-DEVELOPER-MCP-02. | [Route receipt](../reviews/2026-11-17-developer-mcp-route.json), [provider receipt](../reviews/2026-11-14-real-sandbox-smtp-proofs.md); commits `7dd2d33` and `a3d72f0` record 141 Developer MCP tests with zero skips |
| Brain is only a library, or its browser UI proves semantic search | `/brain` has an entitlement-gated unavailable state. Search, recent decisions and signal controls are not composed in this host. The signed API remains separate; deterministic token hashing is not hosted semantic search. | [Brain browser cases](../../tooling/e2e/specs/brain-state.spec.ts), [wave-5 executed receipt](../adopters/wave5-wiring-verification.md) |
| Support email and AI review are only in-memory library services | Durable email and suggestion stores, ticket UI and review APIs exist. The browser receipt proves persistent review without ticket mutation. Routed generation and rejected-output quarantine remain unavailable; a separate human reply action sends. | [Wave-5 receipt](../adopters/wave5-wiring-verification.md), [host configuration and missing dependencies](../adopters/wave5-ai-wiring.md), [V1 database families](../../tooling/ci/db-sequence-inventory.md) |
| Model-provider adapters are future work | Wave-5 R5 adds OpenAI-compatible and Anthropic-compatible chat plus OpenAI-compatible embeddings, followed by typed host composition. Synthetic fixtures prove contracts; no live model-provider validation is recorded. Vercel AI Gateway has no separate proven adapter. | Commits `ac2aa6e`, `9126d0e`, `a4cfbde`; [wave-5 configuration](../adopters/wave5-ai-wiring.md) and [verification](../adopters/wave5-wiring-verification.md) |
| Quality contracts have no persistence | E18 adds insert-only, audited artifact-bound persistence and a trusted host factory. It has no HTTP caller and does not implement Lab phases 1 through 4. | [Accepted persistence design and evidence](quality-contract-persistence.md), [wave-5 wiring receipt](../adopters/wave5-wiring-verification.md) |
| Passing production-budget tests closes UAT-015 | V3 passes 6/6 frozen no-regression tests. Assessment still misses 2,500 ms LCP and 0.1 CLS, with final enforcement at 3,612 ms and 0.747693. Shared shell payload also misses its target. UAT-015 stays open. | [V3 measured baseline, targets and verification](../reviews/2026-11-17-wave6-v3.md), [raw measurements](../reviews/2026-11-17-wave6-v3-baseline.json) |
| Workflow definitions establish hosted CI or KVM proof | GitHub Actions is billing-blocked; no hosted receipts are available for these waves. OWNER-KVM-CI-01 still requires an approved runner and actual receipt. Local/static checks do not clear it. | [V1 workflow limits](../../tooling/ci/db-sequence-inventory.md), [owner gates](../OWNER-TASKS.md) |
| README's 37/37 non-owner tasks in a 43-task backlog describes all current work | The legacy controller ledger has 53 completed non-owner tasks and four pending owner entries. It does not track completion of the later UX waves. | [Governed controller ledger](unattended-backlog.json), [UX wave plan](2026-11-15-ux-fix-plan.md) |

Earlier handoff sections and dated reviews retain their original counts and
limitations as history. V3's historical 114/115 quality run remains a failed
aggregate check at that revision. `d818389` records the later phase-registration
repair and focused checks, not a new full quality run or full browser run.

## Wave-7 results

- UAT pass rate: 4 of 30 journey-width checks pass, 2 fail and 24 are blocked
  ([Q1 r1](../reviews/uat-2026-11-17/q1-findings-r1.md)). UAT-020 and the
  fixture blocks are fixed in wave 7; the re-run is outstanding.
- ECS: **4.25** ([receipt](../reviews/2026-11-17-ecs-wave7.md)).

E11 supplies neither result and infers no score increase from added tests.
Hosted CI, live model-provider validation, production approval, public npm
publication and counsel-gated release/licensing decisions remain unproven or
gated. This reconciliation requires no marketing-site update. A later change
to public product truth must follow the the separate marketing repository’s review process.

## E11 documentation checks

- `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` passed,
  zero downloads and no tracked manifest/lockfile changes.
- `pnpm docs:links` passed across 180 files and 452 local links, including
  12 cross-file anchors, with zero failures. External URLs were excluded by
  the checker.
- `git diff --check d818389` passed. A focused `rg` check found no old
  63/18/183, 37-of-37/43-task, no-successful-route, future-adapter or
  in-memory-only-delivery assertions in the current product, requirement,
  provider and MCP/email summaries.
- Scope review confirms only Markdown documentation changed. Dated review
  files, controller state, code, tests, workflows, migrations, package files
  and generated output are unchanged. Historical counts remain explicitly
  scoped to their earlier revisions.

Dependency installation and link checking ran through foreground forge-job
units. This verification supplies no wave-7 UAT result or engineering score.
