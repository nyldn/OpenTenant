# Wave 0 B0 verification

Date: 2026-11-16. Source base: `2c89c23a09bc5fe14955c920ac190022607c7d3d`.
Implementation: `79743aa0857cb762965a02075a123cbb128d05d4`, branch
`t3/wave0-b0`. Marketing impact: none. No push or PR.

B0 changes tooling, fixture HTML and documentation only. Application source is
unchanged. The frozen scan v2 matrix contains all 35 historical probes plus four
tenant-state probes, six personas and three viewports, 702 cells. See
[inventory delta](inventory-delta.json) for the exact route/context crosswalk
and [fixture contract](README.md) for the exported helper API and phase rules.

The baseline permits existing defects while preventing additions. It is not a
passing accessibility or BrowserOS UAT claim. Current violations are 514 serious
rule instances: 390 color-contrast, 114 target-size and 10
scrollable-region-focusable. Critical, moderate and minor counts are zero.
There are 5,176 affected-target fingerprints. Compared with the old scratch run,
fixture accounts, tenant hosts and seeded content are explicit; four additional
probes add 72 cells. Raw non-HTML API denials are receipts rather than axe HTML
findings. The local module fixture now has title/lang. The historical 329 contrast
instances remain evidence of that older run, rather than the new baseline count.

## Checks

| Command | Result |
| --- | --- |
| `pnpm e2e` | Passed, 722 cases with zero skips. Local identity 11/11 in 1.5 minutes, Better Auth 8/8 in 2.6 minutes, reset 1/1 in 4.1 minutes and audit 702/702. |
| `pnpm a11y:scan`, invoked by the complete local E2E command | Passed, all 702 cells executed once; zero differences. Matrix `completed: true`, comparison `pass: true`. |
| `pnpm uat:start` → `pnpm uat:status` → `pnpm uat:reset` → `pnpm uat:down` twice | Passed. Status reported tmux `opentenant-uat`, unit `forge-job-opentenant-uat-ad4bc7cb7899.service`, 28,745 seconds remaining, and seven ports verified by `ss` to bind only to `127.0.0.1`. Reset returned `verified: true`. All recorded ports closed afterward; session absent and unit inactive. |
| Duplicate `pnpm uat:start` during an active run | Rejected without disturbing the active controller. |
| `pnpm turbo typecheck lint test --concurrency=2` | Passed, 112 tasks. The E2E package has 16 Node tests, including comparison failures, TTL, normal cleanup, guardian EOF and actual launcher SIGKILL. |
| `pnpm e2e --list` | 11 local, 8 Better Auth, 1 reset and 702 audit cases; every spec has an explicit provider/phase and expected collection count. |
| `pnpm --filter @opentenant/platform build` | Passed. Next compiled and generated all 29 routes; existing rate-limiter dynamic-import warnings remain. |
| `pnpm docs:links` | Passed, 166 files, 390 local links, zero failures. |
| `pnpm audit --prod --audit-level high` | Passed; zero high/critical, five moderate and one low. |
| `git diff --check` | Passed. |

Repository-scoped Semgrep with three inspected local rules reported zero
findings. Its 17 parser diagnostics concern unchanged files; no B0 file has a
parse diagnostic. The local Trivy filesystem scan used its cached database
and reported zero high/critical and three medium vulnerabilities. Source-wide
Gitleaks reported 11 unchanged Assessment storage-key matches; the B0 changed
files, including the baseline, reported zero leaks. These are scoped scanner
receipts, not a claim of a comprehensive security review. No pre-commit or
Promptfoo configuration exists in this checkout. Graphify was refreshed locally
and is excluded from the commits.

## Complete matrix and batch measurements

The final matrix reports source `79743aa0857cb762965a02075a123cbb128d05d4`
and `workingTreeChanged: false`, excluding generated Graphify files. It contains
666 product documents, three permitted opaque fixture documents and 33 raw API
denials. Outcomes were 369 content, 219 redirected, 105 denied and nine blank
HTML denials. All of these receipts match the baseline. Incomplete axe checks
remain in 87 cells for manual review.

The committed baseline SHA-256 is `f8d8e0c723fdba2b9ec7bbe24bf1031d99d6a94912c1284a5d8e6b31c2b68850`.
The independent comparison accepted it without any baseline edits after switching
to the guarded direct-run path.

Profile: Node v22.23.2, Playwright 1.61.1, Chrome for Testing 149.0.7827.55,
axe Playwright 4.11.0 and axe-core 4.11.4. The host reports AMD Ryzen 5 6600H,
12 logical CPUs and 31,775,150,080 bytes of RAM. Forge bounds the whole job to
6 GiB, 400% CPU and 256 tasks. Runs use Next dev, so these are harness resource
measurements rather than production latency or minimum allocation claims.

| Batch | Cells | Elapsed seconds | Sampled Next process-tree peak RSS, MiB |
| --- | --- | --- | --- |
| 1 | 90 | 217 | 3636 |
| 2 | 90 | 218 | 3628 |
| 3 | 90 | 222 | 3348 |
| 4 | 90 | 223 | 3427 |
| 5 | 90 | 274 | 3936 |
| 6 | 90 | 204 | 3501 |
| 7 | 90 | 210 | 3540 |
| 8 | 72 | 220 | 3334 |

Elapsed time includes seed, browser execution and teardown. RSS is sampled once
per second for the Next process tree and is not a whole-job peak. Separate
cgroup samples reached 251 tasks without task-limit hits and 5,439,094,784 bytes
of whole-job peak memory. Every batch uses one browser worker and a fresh server
and database cluster. All seven final audit ports closed; controller/manifest,
workspace-labeled containers and the job were absent after cleanup. Forge audit
reported no unmanaged development servers. The final UAT service sequence then
verified its seven listener bindings, reset, two shutdowns and stopped status.

## Failed attempts and corrections

The first candidate Assessment cell at installation-owner/390 timed out after
180 seconds waiting for `networkidle`, despite a rendered page. The scanner now
uses document load, local font readiness and visible Assessment navigation. The
single rerun passed that cell in 5.0 seconds and the 90-cell batch in 3.7 minutes.
Both attempts remain in private local logs and failed-cell receipts.

The first complete E2E invocation passed all 20 journey/reset cases and 359 audit
cells, then timed out after 180 seconds on managed-support/brand-proposals at
1440. Its rendered page was the expected sign-in form. The single isolated
rerun passed in 32.4 seconds including cold compilation. The scanner now polls
the current document's loaded-font state and gives font and axe analysis named,
bounded test steps. The failed 360-cell partial matrix and both logs remain
private under `.uat/`; it is not a passing full-matrix receipt. A fresh complete
E2E invocation is the final comparison proof recorded above.

An intervening complete-run retry passed the 19 existing browser cases but was
interrupted during reset when the Forge supervisor detected its launching
session had exited. It reported one interrupted/skipped case and was kept as a
failed attempt. The replacement used an explicit foreground Node owner for the
Forge launcher. It passed the updated reset in 2.8 minutes, including seed
mail replay and a fresh restart, and executed all 702 audit cells. Its strict
comparison then failed on 33 differences. Axe had generated alternate CSS
selectors for the same elements, seed ticket timestamps tied, and the helpdesk
projection could still be empty at first navigation. Scan v2 converts every
single-document target to a verified unique element tag/position path. The seed
uses fixed unique times and finishes the canonical helpdesk rebuild and outbox
projection before serving. No rule was excluded and no application source changed.
This is the initial B0 schema freeze before later waves use the contract. The
ready helpdesk table has focusable ticket links, which removes the empty-table
scroll focus finding from the prototype capture. All 702 authorization receipts
were unchanged during v2 preparation.

A subsequent classification recapture stopped after 15 passing cells when
managed-support `/support` returned 500, with a missing generated webpack chunk.
The harness now clears generated `.next` output before every dev start and reset
restart. The corrected 90-cell batch passed in 2.6 minutes. A later candidate
again failed there after 465 cells when a concurrent Turbo quality check restored
its cached platform build over the active dev compiler output. That was a
verification scheduling error. The complete failed batch was rerun on a fresh
server with quality/build checks serialized. One resumption was interrupted
when its tool session ended after 45 passing cells; Forge removed the owned
workload. A retained foreground PTY then completed the resumption. No failed or missing
cell was admitted into the baseline. Candidate recaptures also verified that
Beta/hostile/fresh tenant-owner probes use their actual seeded owners and that
empty remote-proxy 404 bodies are classified separately from product documents.

A later strict v2 invocation passed all 20 journey/reset cases and 411 audit
cells, then the managed-support Assessment dimensions cell at 390 exceeded its
60-second axe stage deadline. Its expected sign-in form had rendered. The single
isolated rerun passed in 30.9 seconds including cold compilation. Single-document
cells now use axe's documented direct-run mode, with a frame-attachment guard;
framed documents retain the full cross-frame algorithm. The baseline was left
unchanged, so the complete verification must reject any omitted findings. The
focused 90-cell Assessment/Brain batch passed in 3.8 minutes with zero baseline
differences; the affected managed-support cell passed in 1.5 seconds.

Earlier startup checks exposed a Mailpit response API mismatch, an invalid local
MCP resource hostname and inconsistent tmux exact-target syntax across commands.
Those were fixed before the final successful lifecycle sequence. Private
manifests, cookies, invitation links, logs and raw browser traces are not committed
or included in the CI audit upload. The new GitHub job has not been run remotely.

The CI service-mode Postgres proof passed under `pnpm db:ephemeral`: unique
control database creation, required PostgreSQL 17/pgvector, idempotent cleanup,
and unchanged inventory of unrelated databases. A separate real Mailpit proof
passed snapshot/replay and removal of extra messages. Reset now replays seeded
invitations through the existing SMTP transport and verifies recipient, subject,
text and message count, so the next pending-owner journey retains its mail.

## Opaque fixture diagnostic

The three permitted remote-fixture cells retain a `SecurityError` with service
worker/sandbox flags at `/m/e2e-stub`. Chromium supplies no URL stack for it.
The script-free upstream cannot register a worker. The pinned Playwright 1.61.1
`serviceWorkers: "block"` init script reads `navigator.serviceWorker` before
replacing registration; the opaque origin makes that getter throw. An isolated
script-free CSP fixture reproduced one error with blocking and zero with the
diagnostic control. Both stayed opaque and unable to access service workers.
The normal harness keeps blocking, sandbox CSP and cookie stripping; errors
remain in the matrix, with no console allowlist.

## Handoff

`fixtures.ts` also exports `root` and the `UatManifest` type. The fixture
manifest is v1, scan schema is v2 and the audit identity phase is Better Auth.
`startTestStack(logPath, { audit? })` returns `{ manifest, dispose }`; always
dispose before another service starts. `resetFixtures()` restores the seed.
Read the manifest again after reset to refresh its revision and support cache.

Page specs can use the ordinary `platformTest`, `tenantTest`, `tenantOrigin` and
`signIn` re-exports. Rich standalone UAT tests can use `readManifest`,
`fixtureOrigin`, `personaId`, `personaHost`, `signInPersona`,
`guardLocalRequests`, `assertFixtureIdentity`, `visitPrivateLink`,
`assessmentKey`, `withFixtureControl`, `mailMessages`, `mailMessage`,
`startTestStack` and `resetFixtures`. Register new files and exact counts in
`audit/phases.mjs` through the shared harness owner. Do not launch two Next servers
in the same worktree. The integrator owns the shared handoff/ship-log update.
