# Fixture v1 and scan v2 contract

The identity phase is `audit`, always Better Auth. Register every new spec and its expected case count in `phases.mjs`. Unknown
or duplicate registrations fail before collection; the reporter checks provider
and exact unfiltered collection counts.

The normal journey phase
also uses Better Auth; legacy specs alone use LOCAL_USERS. `reset` owns its
own Better Auth service and must run without another Next server. One worker
runs at most five route/state definitions, 90 cells, on a fresh server and
cluster. Eight batches execute all 702 cells. No automatic retries or skip
filters apply to this matrix.

The old scratch audit was recovered from a sibling worktree. Its main 31
route/state probes plus two extra probes and two MCP forms account for all 630
historical cells. `inventory-delta.json` records the exact old routes and context
changes. The maintained inventory retains every historical probe and adds Beta,
hostile and fresh home plus pending-host claim, 72 extra cells. Stable IDs are
now `persona|route-state|widthxheight`. The `knowledge` scenario visits `/brain`.

The audit uses verified localhost hosts instead of a shared localhost origin
with a development tenant cookie. Admin/member use Alpha memberships rather
than the old workspace memberships. The explicit theme home probes use that
host's seeded owner for the tenant-owner cells; managed support uses a dedicated operator
with no membership. Tenant detail/proposal/claim probes target the persona's
host tenant. Ticket detail selects that persona's visible seeded SUP-000001 ticket,
or an explicit nonexistent ticket when none is visible. Assessment starts from
the UAT partial draft instead of the old completed keyboard journey. The stub
now supplies title/lang. Raw MCP and remote-proxy denials remain HTTP receipts and are excluded
from product axe totals. These explicit fixture/context changes mean current
counts need not equal the historical 526 rule instances or 329 contrast results.

`baseline.json` freezes observed status/final path/document kind/headings per cell and
rule/impact/target/node count per tenant/persona/route-state/viewport. Initial
response receipts must be reviewed against role boundaries. Later unexpected
responses fail even if they reduce accessibility findings. Every single-document
target uses its element tag/position path rather than axe's generated class
selectors. Disposable UUIDs are normalized in other fields; tenant IDs, personas
and theme hosts are preserved.
Single-document cells use the documented direct `axe.run` mode, guarded against
frame attachment during analysis. Documents with frames keep the default full
cross-frame algorithm. No frame or rule exclusions apply. Incomplete axe checks remain in matrix JSON for manual
review. Diagnostics include title, h1, labels and document overflow; these are
recorded deficiencies until later owners add their page-specific assertions.

Run `pnpm a11y:scan --counts` to scan, compare and print impact/rule counts.
`--candidate` scans to a separate candidate file and never overwrites the
baseline. A new target, higher impact or node count fails. Fixed or reduced
entries must be removed/reduced in source. Increasing the reviewed baseline
requires an owner/reason/expiry exception outside this command. The baseline
reached zero violations on 2026-11-17, so zero is now a hard threshold.
Document moves need a reviewed `remap-*.json` committed together with the
baseline. Those manifests may move only `final` and `headings`; a change of
status, kind or tenant is authorization evidence and fails instead.

Page specs can import the `UatManifest` type and `root` plus these helpers from
`fixtures.ts`: `readManifest`, `fixtureOrigin`,
`personaId`, `personaHost`, `signInPersona`, `guardLocalRequests`,
`assertFixtureIdentity`, `visitPrivateLink`, `assessmentKey`, `withFixtureControl`, `mailMessages`
and `mailMessage`. DB access and mail contents are private fixture data. Use
`startTestStack` from `tooling/uat/test-stack.mjs` in a try/finally to own a
standalone service. After `resetFixtures`, call `readManifest` again before
using persona helpers so the fixture revision and support-session cache refresh.
Call `dispose` before restarting. Do not print persona URLs,
cookies, DB handles, mail links or private manifests. Scan JSON contains no
cookies, query strings, HTML or credential-bearing driver messages.

The reset proof exercises no-memberships and the pending invitation login
explicitly. It asserts the current data boundary. It does not turn UAT-017's
missing sign-out control or UAT-010's pending-owner signup into passing UX claims.

Ordinary page specs in `legacy` or `journeys` can import the existing runner
fixtures through this module as `platformTest`, `tenantTest`, `tenantOrigin`
and `signIn`. `readManifest` and the persona/mail helpers instead require a
standalone UAT stack. For those specs, ask the integrator to register the file
and case count in the service-owning `reset` phase, then use `startTestStack`
and dispose it in finally/afterAll. Do not start UAT beside the normal runner's
Next server, since both use the same worktree build directory.

The dev harness clears generated `apps/platform/.next` output before each
server start and reset restart. This prevents webpack chunk references from a
previous batch being reused by a new compiler. Application source is unchanged. Do not run builds or Turbo quality checks while a
browser service is active: Turbo restores cached `.next` build outputs and can
corrupt the live dev compiler. Run those checks before or after browser work.

Scan v2 is the initial frozen handoff schema. The development v1 capture used
axe-generated CSS selectors; a complete comparison exposed selector aliases
for the same elements, ticket timestamp ties and a projection startup race.
Before freezing v2, fixture timestamps were fixed and unique and the production
helpdesk rebuild/outbox projection completed before serving. Existing violations
are recaptured under stable element paths; this is initial B0 schema preparation,
not permission for subsequent waves to increase the baseline.

`matrix.completed` is true only after the full unique cell inventory validates.
`comparison.pass` is the independent baseline comparison result. Partial or
interrupted uploads remain `completed: false`. Each invocation clears earlier
comparison/candidate outputs and initializes an incomplete matrix before startup,
so a startup failure cannot leave a previous passing receipt behind.

Source comparisons use HEAD locally, the PR base SHA for pull requests and the
previous push SHA for pushes. A first push without a previous commit uses HEAD
for initial capture. The CI checkout fetches full history for this comparison.

The three permitted remote-fixture cells retain a `SecurityError` with service
worker/sandbox flags at `/m/e2e-stub`. Chromium supplies no URL stack for it.
The script-free upstream cannot register a worker. The pinned Playwright 1.61.1
`serviceWorkers: "block"` init script reads `navigator.serviceWorker` before
replacing registration; the opaque origin makes that getter throw. An isolated
script-free CSP fixture reproduced one error with blocking and zero with the
diagnostic control. Both stayed opaque and unable to access service workers.
The normal harness keeps blocking, sandbox CSP and cookie stripping; errors
remain in the matrix, with no console allowlist.

The clean import starts with the reviewed baseline. Remap manifests for new
changes must accompany the baseline diff in the same commit.
