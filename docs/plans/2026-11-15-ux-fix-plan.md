# OpenTenant UX and engineering fix plan

Date: 2026-11-15. Source baseline: `5748c5d6e55a735090e50725829bc88cbd85d388`.
Planning only. This document changes no application behavior, starts no service,
and authorizes no provider activation, publication or production operation.
Marketing impact: none.

## Status note, 2026-11-17

The source findings and acceptance tables below retain the Nov 15 planning
baseline. Use the [E11 reconciliation ledger](2026-11-17-e11-reconciliation.md)
for current receipt-backed documentation and count corrections. R5 adapters
and typed host composition exist with synthetic verification only. V2 now has
the actual [local microVM route receipt](../reviews/2026-11-17-developer-mcp-route.json),
separate from the earlier provider proof; production remains disabled behind
OWNER-DEVELOPER-MCP-02. These facts supersede the E10/E12 missing-implementation
descriptions at the planning baseline, without changing their accepted scope.

E11 documentation is reconciled against `d818389`; it does not supply new
behavioral verification. [V3's six frozen-budget tests](../reviews/2026-11-17-wave6-v3.md)
pass while Assessment still misses LCP/CLS and the shared shell exceeds its
payload target. UAT-015 stays open. GitHub Actions is billing-blocked, so hosted
receipts remain unavailable; OWNER-KVM-CI-01 is still pending.

Current wave-7 UAT pass rate: **PENDING integrator receipt-backed rerun**.
Current ECS / E13: **PENDING independent review and integrator receipts**.
No numeric increase follows from test additions. The historical 75-item review
and controller backlog remain unchanged; an empty legacy controller queue is
not completion of this wave plan. Marketing impact: none, existing evidence
reconciliation only.

## Evidence and limits

Read before implementation: [repository rules](../../RTK.md),
[parallel agent rules](../../AGENTS.md#parallel-agent-rules),
[engineering score and reuse policy](2026-11-11-engineering-score.md),
[migration reservations](migration-reservations.md),
[owner tasks](../OWNER-TASKS.md), [UAT](../tooling/uat.md), and
[E2E](../tooling/e2e.md). The three inputs are the
[BrowserOS findings](../reviews/uat-2026-11-15/browseros-findings.md),
[automated findings](../reviews/uat-2026-11-15/automated-findings.md), and
[75-item backlog](../reviews/uat-2026-11-15/backlog.md).

Source inspection and `rg -n` verified the locations below at this baseline.
Graphify query supplied navigation; source controls the conclusions. No browser
journey, production benchmark or remote GitHub-history check was rerun for this
planning task. New test names below are implementation targets, not passing
receipts. A source-confirmed defect still needs a red behavioral test before its
fix. Where the cause is uncertain, the first deliverable is reproduction and a
safe diagnostic, not an assumed application patch.

| Input claim | Checked interpretation |
| --- | --- |
| 19 BrowserOS findings, 15 journeys, two widths | Report contains UAT-001 through UAT-019, six P1, eleven P2, two P3, tested at 1440 and 390. Journey 2 passes its data boundary with a branding-picker caveat; journey 6 is partial on desktop. Screens/PDFs are on the Mac, not in this checkout. |
| 630 automated scans show systemic failures | 630 combinations completed; only 309 reached authorized content. There are 329 contrast rule instances, 526 total axe rule instances, 3,899 affected-node instances and 64 overflowing cells. Contrast was not established on all 630 scans. The 57 UX groups are covered below, including diagnostics and fixture/denial exclusions. |
| 75 backlog items | Count is 22 engineering, 40 owner decisions, 13 external. Engineering includes O17, O19 and O27 as well as E01 through E19. Conditional incident procedures and optional work are not all immediate tasks. |
| ECS 4.75; DX env-lint incomplete | Treat 4.75 as the supplied checkpoint, not a fresh grade. No tracked evidence-only 4.75 calculation was found. `docs/reviews/2026-11-11-ecs-wave5.md:125` explicitly says no independent regrade occurred. The later family lint already covers computed access, aliases and loader families in `tooling/config/environment-policy.mjs:15`, with runtime scope at `eslint.config.mjs:126`. Verify completeness and receipts before inventing a new bypass fix. |
| Maturity lacks public npm provenance | Local publication is not public provenance. Release approval remains unchecked at `docs/OWNER-TASKS.md:16`; local receipts do not close it. |
| KVM, SMTP, release, dx-timed, restore-drill never ran on GitHub | Source proves jobs exist, not their run history. `docs/OWNER-TASKS.md:3` records new KVM proof awaiting CI. SMTP/KVM have later local proof. Collect remote receipts when authorized; call these missing verified GitHub receipts, not independently confirmed never-run jobs. The dx-timed command is in the `create-opentenant` job at `.github/workflows/ci.yml:128`. Include `release-local-proof` receipts too. |

## Phase 0: contracts and shared foundations

Reuse the existing public exports in `packages/design-system/src/index.ts:4`:
Button, Card, Input, Label, Textarea, Select, Alert, Empty, Dialog, Sheet,
Sidebar, Breadcrumb, ScrollArea, Table and Sonner. Sidebar already switches to
Sheet on mobile at `packages/design-system/src/components/ui/sidebar.tsx:186`.
Do not install another component library or copy premium/unattributed components.
There is no exported Form or AlertDialog today. Compose a small shared field and
status wrapper from the existing pieces; use Dialog with explicit destructive
confirmation semantics rather than assuming a nonexistent export.

Reuse `currentSession`, `tenantAdminContext`, `brandProposalAdminContext`,
`sameOrigin`, `readBoundedForm`, the canonical migration runner, Graphile jobs,
and the existing permission contracts. Never grant installation owners ambient
tenant authority, trust a form's tenant ID, weaken CSP, bypass forced RLS, or
turn production identity checks off to make UAT green. Preserve safe API errors;
render human-facing errors through the form/page layer.

The foundation owner defines these contracts before page agents branch:

- Semantic pairs for background, card, popover, primary, secondary, muted,
  destructive, sidebar, focus and status colors in light/dark modes. Tenant
  brand values must resolve a complete usable palette. Keep raw logo/chart
  accent values separate from accessible text/control colors. Validate or
  deterministically fall back when a tenant chooses an unusable pair. Avoid
  page-specific hex overrides and opacity tricks that recreate contrast bugs.
- One host application shell with authorized navigation contributions, mobile
  Sheet menu, account controls, Home/back destination, skip link, page heading,
  breadcrumbs and a managed-support banner with a reachable exit action.
  Compose it at authenticated host boundaries, including native module dispatch. For remote modules, add a host-owned framed
  entry using the same shell and keep `/m` as the sandboxed content/proxy route.
  `apps/platform/app/m/[module]/[[...path]]/route.ts:157` deliberately sandboxes
  upstream HTML. Never inject trusted shell markup into that untrusted response
  or relax the opaque origin to add navigation. Keep auth, unknown-host and suspended states renderable independently. Modules
  receive host context through existing ports, without importing Next internals.
- Shared field composition with visible Label, stable IDs, help/error linkage,
  `aria-invalid`, pending/disabled state, focused error summary, `role=alert`
  errors and polite `role=status` success. Retain safe input after errors, clear
  passwords, and support retry. Toasts supplement inline status.
- One Access denied page and one empty/unavailable composition using Alert and
  Empty, with a heading and an allowed next action. Distinguish signed out,
  forbidden, unavailable and genuinely empty data. Keep JSON APIs as JSON.

## Fleet waves and file ownership

Estimates are total focused agent-hours including tests/review, not calendar
promises or legal/account waiting time. Per-finding effort: S up to 4 hours,
M about 4–12, L about 12–24 or a cross-cutting change. Shared fixes are counted
once in wave estimates, not once per finding. Run at most four agents at once.

| Wave | Items | Parallelism | Serial points | Agent-hours | Expected effect |
| --- | --- | --- | --- | --- | --- |
| 0 | B0 reproducible baseline, scan inventory, Mailpit and UAT lifecycle design | One harness owner; source triage can run alongside | Freeze fixture/scan schema and identity phase before tests fan out | 10–16 | Makes UAT results trustworthy; E08/E14 |
| 1 | F1 tokens/forms/states; F2 application shell and early host gate | F1 then F2; no page fan-out until exports settle | DS barrel, theme resolver, root layout, shell dispatch | 20–30 | Largest contrast/mobile UAT gain; E05/E06/E07 |
| 2 | D1 Assessment P1; A1 Better Auth/proposal authority/claim; L1 deletion undo and job progress | Three disjoint owners | Migration reservations before SQL; freeze Assessment state before polish | 36–54 | Removes data/lifecycle P1 and two blocked journeys |
| 3 | S1 settings; S2 admin; S3 Support UI; S4 Brain; S5 Assessment UI | Up to four, then fifth | A1 hands branding/settings to S1; L1 hands tenant detail to S2; D1 hands module to S5 | 28–42 | Labels, feedback, navigation, denial, overflow; E06/E07/E15 |
| 4 | R1 domain scheduler; R2 OpenFGA; R3 durable Support email; R4 export bounds | Four directory owners | One integrator wires worker/config/migrations after helpers merge | 48–72 | E01/E02/E03/E09; operational reliability |
| 5 | R5 model ports; R6 reviewed Support AI; R7 quality persistence; R8 tool/provenance prep | Up to four; E19 design only after R6 | Proposed contracts reviewed first; R6 follows R3 | 30–46 | E10/E16/E17/E18/E19, O17/O19/O27 |
| 6 | V1 CI/env-lint gate; V2 actual MCP microVM proof; V3 built performance/accessibility/download proofs | Three owners | V1 alone merges CI/root script changes; build fixture contract precedes V3 | 24–36 | E04/E08/E12/E15; supports DX/AI/Maturity evidence |
| 7 | Q1 full BrowserOS rerun/reset, E11 docs, E13 independent regrade, CI receipts | Browser UAT and fresh-context grade can run together | Final source freeze; docs/counts only after receipts | 12–18 | Verified UAT pass rate and ECS; no automatic score claim |

Total: roughly 208–314 agent-hours. Waves 4 and 5 may proceed alongside wave 3
once foundations and their relevant prerequisites land. Do not delay D1 behind
polish. A practical UAT critical path is B0 → F1 → F2 → D1/A1/L1 → page adoption
→ V1/V3 → Q1. The route-proof/ECS path adds V2, missing CI receipts and the
independent rubric review. Public provenance is an owner-dependent branch.

Each item below owns its tests with the same stem or explicit spec name. Existing
files stay with their named owner for the whole item. A file listed under a later
wave transfers only after the prior owner merges. Any path not assigned here
needs an integrator assignment before editing. A glob grants no ownership of
an explicitly excluded/shared path.

| Item | Exclusive implementation paths and tests |
| --- | --- |
| B0 | `tooling/uat/**`, `tooling/e2e/{run.mjs,run-phase.mjs,platform-server.mjs,global-setup.ts,playwright.config.ts,upstream.mjs}`, proposed `tooling/e2e/audit/**`, `tooling/e2e/specs/persona-a11y.spec.ts`, `tooling/e2e/specs/uat-reset.spec.ts`, `docs/tooling/{uat,e2e}.md`. Export fixture helpers for page specs. Root scripts, e2e package manifest and lockfile via integrator only. |
| F1 | `apps/platform/app/globals.css`, `apps/platform/lib/custom-domains-theme.ts` and its tests, `packages/design-system/src/**`. Own new field/status/access-state wrappers and the barrel. Publish final signatures before F2. |
| F2 | Proposed `apps/platform/app/_components/application-shell*.tsx`, `apps/platform/app/{layout.tsx,page.tsx,auth-controls.tsx,tenants/page.tsx}`, `apps/platform/app/settings/layout.tsx`, `apps/platform/app/[...modulePath]/page.tsx`, `apps/platform/{middleware.ts,next.config.ts,lib/custom-domains-resolution.ts,lib/tenant.ts}`, proposed internal host-resolution handler, `apps/platform/lib/module-navigation.ts`, proposed `apps/platform/app/modules/[moduleKey]/page.tsx` remote frame and focused host/shell tests; `tooling/e2e/specs/{application-shell,unknown-host}.spec.ts`. Keep module registry and routing contracts intact. |
| D1 | `modules/assessment/src/{store.tsx,types.ts,respondents.ts,assessment-shell.tsx,assessment-results.tsx,persistence/**}` and associated state/export tests; `tooling/e2e/specs/assessment-engagement.spec.ts`. Hand all Assessment UI files to S5 afterward. |
| A1 | `packages/auth-better-auth/src/**`, `packages/auth/src/brand-proposal-authority*.ts`, `apps/platform/lib/{tenant-admin.ts,identity.ts,tenant-owner-invite.ts}` and focused tests, `apps/platform/app/api/auth/better-auth/**`, `apps/platform/app/admin/tenants/[tenantId]/{brand-proposals/**,owner-claim/**}`, `apps/platform/app/api/admin/{brand-proposals/**,tenants/[tenantId]/owner-claim/**}`, `tooling/e2e/specs/{better-auth,brand-proposals,owner-claim}.spec.ts`. B0 integrates any fixture fixes; F1 exports form primitives. |
| L1 | `apps/platform/lib/{tenant-lifecycle*.ts,tenant-erase.ts,tenant-worker-store.ts}`, `apps/platform/app/admin/tenants/{tenant-action-form.tsx,[tenantId]/page.tsx}`, `apps/platform/app/api/admin/tenants/[tenantId]/{lifecycle/**,jobs/**}` and proposed read-only job-status handler; `tooling/e2e/specs/{lifecycle,job-status}.spec.ts`. S2 receives detail UI afterward. |
| S1 | `apps/platform/app/settings/**` excluding layout, and `apps/platform/app/api/settings/{branding/**,members/**,navigation/**,routine-configuration/**,domains/**}`; `apps/platform/lib/{custom-domains.ts,custom-domains-handler.ts,tenant-domain-settings.ts}`; proposed tenant branding-asset helper/handler. Related settings tests and `tooling/e2e/specs/{settings-feedback,settings-mobile,branding-assets,domain-recovery,permission-states}.spec.ts`. A1 only exports authority helper; it does not edit these pages. |
| S2 | `apps/platform/app/admin/**` excluding A1 paths and `tenant-action-form.tsx`; tenant detail only after L1. `tooling/e2e/specs/admin-accessibility.spec.ts`. Retain request-level installation authority. |
| S3 | `modules/support/src/{host-page.tsx,host-ticket.tsx}` and their UI tests; `tooling/e2e/specs/support-accessibility.spec.ts`. Export wiring request to integrator if host ports need extension. |
| S4 | `modules/brain/src/{manifest.ts,BrainSurface.tsx}` and focused render tests; `tooling/e2e/specs/brain-state.spec.ts`. F2 owns host dispatch, R5 owns embeddings/service composition. |
| S5 | `modules/assessment/src/**` after D1, excluding later model-provider work; `tooling/e2e/specs/assessment.spec.ts`, `tooling/e2e/specs/assessment-accessibility.spec.ts`. Keep D1's engagement regression immutable. |
| R1 | `apps/platform/lib/custom-domains*.ts` after S1, `packages/domains/src/verification*.ts`, proposed domain-job helper/tests; `tooling/e2e/specs/custom-domains.e2e.spec.ts`. Export worker task and schedule text, never edit shared worker directly. |
| R2 | `packages/authz/src/**`, `apps/platform/lib/module-access.ts`, proposed authz lifecycle/outbox helper; `apps/platform/app/api/settings/{members/**,modules/**}` after S1. Ask integrator to wire owner grant, entitlement and manifest-publication sites. `tooling/e2e/specs/authorization-sync.spec.ts`. |
| R3 | `modules/support/src/**` after S3 excluding `support-ai*` and `reply-scaffold*`, `packages/database/src/tenant-support*` and proposed delivery-store files. `tooling/e2e/specs/support-email.spec.ts`. Export worker task; coordinate database barrel/host ports via integrator. |
| R4 | `apps/platform/lib/tenant-export*.ts`, `apps/platform/app/api/admin/tenants/[tenantId]/exports/**`, `tooling/e2e/specs/export-bounds.spec.ts`. Coordinate any sink signature change with tenant erasure through integrator. |
| R5 | `apps/platform/lib/model-router*.ts`, `modules/brain/src/{embeddings*,service*}`, proposed provider-adapter files within those boundaries. No UI edits. Synthetic adapter conformance tests, no live calls. |
| R6 | `modules/support/src/{support-ai*,reply-scaffold*}` after R3, proposed dedicated suggestion API/store files and `tooling/e2e/specs/support-ai-review.spec.ts`; database/index and host-port wiring via integrator. E19 initially owns only a new composed-reply design document and deterministic fixtures. |
| R7 | `packages/quality-contract/src/**`, proposed `packages/database/src/quality-contract-store*` and `tooling/e2e/specs/quality-contract-binding.spec.ts`; binding/migration registry through integrator. Reconcile proposed design status first. |
| R8 | `tooling/provisioning/src/{app-role*,index.ts}` for O27 local contract work; proposed `tooling/graphify/**`, release evidence under `docs/reviews/`; O17/O19 artifact checks via integrator in `tooling/build/**`. Do not rewrite past reviews or install tooling globally without its normal controls. |
| V1 | `.github/workflows/ci.yml`, `tooling/ci/{db-sequence*,create-integration-databases*,runtime-env*}`, `tooling/config/environment-policy.mjs`, `eslint.config.mjs`; B0's audit/runner files transfer here. Env-gated suite files only for mandatory-gate assertions after respective owners finish. |
| V2 | `tooling/proofs/microvm.mjs`, `tooling/e2e/specs/developer-mcp.spec.ts`, proposed `tooling/proofs/developer-mcp-route.mjs`, `apps/platform/app/api/mcp/developer/{composition.ts,browser.ts}` and focused tests. Request CI wiring from V1. Keep production disabled. |
| V3 | Proposed `tooling/e2e/specs/production-budgets.spec.ts`, production-fixture helpers, export/download evidence; requests B0/V1 runner wiring. No unilateral Next config or root script edits. |
| Q1/integrator | All `package.json`/`pnpm-lock.yaml` changes, `apps/platform/lib/server-config.ts`, `apps/platform/workflows/{tenant-worker.ts,worker.ts}`, database/module barrels, migration catalogs and `docs/plans/migration-reservations.md`; later `README.md`, capability/status docs and new review receipts. Migration DDL gets an individually reserved filename assigned to its implementer. |

The integrator serializes root scripts/lockfile, DS export changes, worker task
registration, configuration, migration numbers and catalogs. Reserve from the
actual free inventory, currently documented as control-plane 0072+; existing
unused blocks remain owned. No reservation or SQL is added by this plan.
Forward migrations only. Feature branches never commit `graphify-out/`.

## UAT findings: cause, fix and failing regression

Every spec path in the next tables is relative to `tooling/e2e/specs/`.
Quoted test names are required case titles. Run applicable cases at both 390
and 1440, with 768 additionally in the scan matrix. All fixes must preserve
server authorization, safe error wording and tenant isolation.

| Finding / owner / effort | Source-confirmed cause or unresolved seam | Fix and acceptance criteria | Named regression to add or extend |
| --- | --- | --- | --- |
| UAT-001 P2 · F2 · M | `apps/platform/app/layout.tsx:37` calls `notFound()` inside the root layout. `apps/platform/middleware.ts:24` rejects malformed hosts, but valid unknown hosts continue. | Resolve/reject unknown hosts at a server boundary before layout rendering. Use a Node-capable pre-render boundary supported by the pinned Next version, or an internal resolution handler called by ingress before forwarding known requests. Validate that integration in a small dev/built spike first; an Edge database import or an unresolved "rewrite then continue" is not an implementation. Unknown responses are complete generic 404 documents. Do not classify all custom hosts as unknown or copy the tenant registry into middleware. Preserve suspended behavior, reserved-header stripping and verified custom domains. Limit local fallback to explicitly approved bootstrap hosts: `apps/platform/lib/tenant.ts:83` currently accepts every .localhost name and can map an unknown name to the default tenant. No overlay, version or tenant data in dev/built unknown responses. | `unknown-host.spec.ts`, "unknown valid host returns generic 404 before layout". Assert HTML contains neither Next error overlay nor stack/version, both signed out and with a cookie; existing status-only coverage is insufficient. |
| UAT-002 P1 · F1 · L | `apps/platform/app/layout.tsx:42` forces dark class with inline tenant style. `apps/platform/lib/custom-domains-theme.ts:12` overrides background/foreground only; dark card/muted values remain from `apps/platform/app/globals.css:127`. Cards often inherit page foreground, e.g. `apps/platform/app/page.tsx:42`, rather than card foreground. Assessment also overrides on-primary with a hard-coded value in `modules/assessment/src/AssessmentSurface.tsx:7`. | Resolve complete semantic color pairs once, then apply paired Card/control primitives through F2/S1–S5. Remove the Assessment-local color override during S5 adoption. Validate tenant palettes including hostile input and light backgrounds under dark chrome. Normal text ≥4.5:1; large text and applicable control/focus boundaries ≥3:1. Zero serious/critical axe contrast results on actual product HTML. | `persona-a11y.spec.ts`, "semantic palette passes contrast for every tenant and theme"; axe `color-contrast`, including Alpha/Beta, primary buttons, muted copy, Assessment dimensions/results and disabled-state manual review. |
| UAT-003 P2 · F2 · M | Nonwrapping fixed-height headers at `apps/platform/app/page.tsx:82` and `apps/platform/app/admin/page.tsx:30`; long account/action row at home line 91. | Shared mobile navigation and account menu, shrinkable brand/account slots, wrapping content. All actions including sign-out reachable by touch and keyboard at 390. Document width ≤ viewport +1px. Keep full identity available via menu/accessible name. | `application-shell.spec.ts`, "long account and admin actions fit 390px"; assert scroll width and open menu/sign-out. |
| UAT-004 P2 · A1 · M | `packages/auth-better-auth/src/http.ts:15` emits JSON failure; login line 60 returns it instead of the form. Catch at line 116 collapses other failures too. | Render a styled browser form and safe inline alert for browser submissions while retaining normalized API errors. Keep email, safe return/invitation context and retry, clear password, focus error summary. Do not expose account existence or provider messages. | `better-auth.spec.ts`, "invalid credentials retain form and announce retryable error"; wrong then correct credentials in same context. |
| UAT-005 P2 · F2/L1 · M | Bare tenant detail at `apps/platform/app/admin/tenants/[tenantId]/page.tsx:12`; line 14 explicitly requests manual refresh. Native dispatcher returns a view without shell at `apps/platform/app/[...modulePath]/page.tsx:29`. | Shell adds Home/back for detail, Support, Brain and modules. Authorized status reads poll every 2–5s while jobs run, back off after errors, pause hidden/offline tabs, stop terminal jobs, offer retry. No full-page reload/focus loss; announce changes once. | `application-shell.spec.ts`, "every module and tenant detail has an allowed return", including the remote framed entry while `/m` retains its opaque sandbox; `job-status.spec.ts`, "queued job reaches completed without reload" including worker failure/retry and permission revocation. |
| UAT-006 P1 · L1 · L | Detail line 18 posts delete immediately. `apps/platform/lib/tenant-lifecycle-policy.ts:6` transitions directly to deleted; `apps/platform/lib/tenant-lifecycle.ts:14` queues erasure. No cancel transition exists. | Existing Dialog asks for tenant confirmation and explains retention/erasure. Server requires explicit confirmed action. Add audited cancellation during retention; restore prior active/suspended state, revoke erase work and recheck under the same lifecycle lock. Cancellation loses safely once physical erasure starts. Prevent stale/retried worker jobs from erasing a restored tenant. Show deadline and persistent undo beyond a toast. | `lifecycle.spec.ts`, "deletion requires confirmation and undo cancels erasure". Cancel dialog changes nothing; confirm schedules once; cancel before deadline restores; concurrent erase/cancel has one valid outcome; after erasure cancellation denied. Add mandatory database race test too. |
| UAT-007 P1 · A1/S1 · L | `apps/platform/lib/tenant-admin.ts:44` validates exact target tenant; lines 47–50 require its admin membership. Better Auth mismatched active org returns tenant_mismatch at `packages/auth-better-auth/src/gateway.ts:52`, which session helper maps to null at `apps/platform/lib/session.ts:31`. Even valid BA sessions have empty permissions at gateway line 55. Branding has only three basic editable keys at `apps/platform/app/settings/branding/page.tsx:7`. | Give a verified tenant owner an explicit entry from Branding and derive approved operation grants through the existing server policy. Keep `packages/auth/src/brand-proposal-authority.ts:36` tenant binding and operation checks. Installation-only authority gets a clear denial, not a login loop or ambient grant. Test actual active-org selection; fixture LOCAL_USERS permissions do not prove Better Auth permissions. Upload/review/apply workflow must persist and audit separately. | `brand-proposals.spec.ts`, "Better Auth tenant owner uploads reviews and applies tenant-bound brand"; negative member, other-tenant and installation-only cases. Assert grants and active org without printing cookie values. |
| UAT-008 P1 · F2/S1 · M | Fixed `w-44 shrink-0` sidebar at `apps/platform/app/settings/layout.tsx:67` shares row/gap/padding at line 66. Branding fields use `w-72` at `apps/platform/app/settings/branding/page.tsx:68`; Navigation repeats it at `apps/platform/app/settings/navigation/page.tsx:54`. | Sidebar becomes mobile Sheet; `min-w-0`, `w-full` with desktop max widths, stacked labels/actions and contained tables. Do not hide overflowing controls or set body overflow hidden. All settings fields usable at 390 without page scroll. | `settings-mobile.spec.ts`, "all settings routes fit and remain operable at 390"; fill/save Branding and Navigation, keyboard-scroll contained tables. |
| UAT-009 P2 · S1 · M | Member removal returns bare forbidden at `apps/platform/app/api/settings/members/route.ts:79`; settings layout redirects at line 24. Members/Identity/Activity return null on denial at `apps/platform/app/settings/members/page.tsx:16`, `apps/platform/app/settings/identity/page.tsx:32`, `apps/platform/app/settings/activity/page.tsx:16`. | Shared Access denied with heading, explanation, announced result and allowed Home/back. Keep anonymous sign-in distinct. Managed support sees classified restrictions and session exit rather than an empty main area. Preserve owner protection and 403 API semantics. | `permission-states.spec.ts`, "member owner-removal and managed-support denials explain next action". Check server rejects mutation and browser never shows a blank main/JSON body. |
| UAT-010 P1 blocked · A1/B0 · L | Exact signup failure remains unproved. Browser form/session binding is at `packages/auth-better-auth/src/http.ts:38`, line 63, with generic catch at 116. Separate owner-claim token is intentional at `apps/platform/lib/tenant-owner-invite.ts:18`; claim validates email/expiry at line 68. | First reproduce from real Mailpit invitation on pending.localhost, recording only safe stage codes: signup, invite acceptance, active org, separate claim, owner-grant job. Compare direct and tunneled origin/cookie behavior; audit fixture data, expiration and retry after partial account creation. Fix the failing stage only. Preserve two separate tokens, matching email, single use and expiry. Complete claim and show durable job status. | `owner-claim.spec.ts`, "pending invite signup accepts membership then claims ownership once". Include existing-account retry, wrong email/tenant, expired/replayed claim; B0 supplies pending fixture. Red end-to-end required before labeling application versus harness cause. |
| UAT-011 P1 data integrity · D1 · L | New calls `resetSession()` at `modules/assessment/src/assessment-shell.tsx:75`; `modules/assessment/src/store.tsx:164` resets session/edit state but keeps respondents. Autosave line 152 reuses engagement metadata; `modules/assessment/src/assessment-results.tsx:120` aggregates the whole respondent list. | Separate New engagement from Clear draft/Add respondent. Serialize replacement with existing persistence queue, new engagement ID, empty respondents/readout/edit origin, verified backup of prior engagement and atomic read-back. Late autosaves must not overwrite the new engagement. Group only within active engagement, including after reload/import/restore. Do not simply filter names in results. | `assessment-engagement.spec.ts`, "client B never aggregates client A after New engagement". A=3, B=4 over all 25 dimensions; B=4, one respondent, JSON/CSV/PDF exclude A; restore A returns A=3. Add autosave race and respondent-edit store tests. |
| UAT-012 P2 · S1/R1 · M | Challenge exists only in React state at `apps/platform/app/settings/domains/custom-domains-form.tsx:7`; line 28 says shown once. `apps/platform/lib/custom-domains.ts:36` persists only hash/expiry. | Persist the record name/status, show copy/download help, and offer authenticated, audited challenge reissue after loss or expiry. Rotate hash, invalidate old verification and stale DNS results under row lock; do not pretend to recover a hash or persist plaintext just to redisplay. Show actionable retry instructions after failure; no cross-tenant challenge access. | `domain-recovery.spec.ts`, "lost TXT challenge can be reissued after navigation and failed verification"; old TXT rejected, new TXT verifies using local resolver. |
| UAT-013 P2 · S4 · S | Active manifest route is explanatory text at `modules/brain/src/manifest.ts:31`, rendered by `apps/platform/lib/module-view.tsx:7`. Editing exported BrainSurface alone does not change that route. | Ship honest "Brain browser tools unavailable" state with configured/local/API distinction and Home link through shell. Do not present deterministic hashing as hosted semantic search. A full search/decision UI is a later scope, not necessary to close this finding. | `brain-state.spec.ts`, "Brain explains browser availability and provides return navigation"; empty, unconfigured and denied personas show distinct states. |
| UAT-014 P3 · S5 · S | Insurance-specific label and placeholder at `modules/assessment/src/assessment-shell.tsx:158` and line 163. Recovery controls show for any ready document at line 203, even without legacy content. | Use Operating profile, neutral industry copy; show recovery details only for actual recoverable legacy material or an explicit advanced action. Preserve backup/export access. | `assessment-accessibility.spec.ts`, "ordinary assessment has neutral profile copy and no irrelevant recovery details"; legacy fixture still has a usable recovery path. |
| UAT-015 P2 provisional · V3 · M | Report measured Next dev compilation, not production. `tooling/e2e/playwright.config.ts:33` starts platform-server; `tooling/uat/serve.mjs:95` selects built mode separately. No production latency cause is established. | Measure compiled start with real BA fixtures, production guardrails intact. Budgets and protocol are below. Profile only failures then tune query/route/chunk work; do not optimize from dev numbers or claim a production regression today. | `production-budgets.spec.ts`, "built critical routes meet latency payload and stability budgets". First capture baseline; it may pass today. The missing budget enforcement is the confirmed gap. |
| UAT-016 P2 privacy · S1 · M | Global static option names are hard-coded at `apps/platform/app/settings/branding/page.tsx:87`; mutation accepts same global options at `apps/platform/app/api/settings/branding/route.ts:12`. `apps/platform/lib/brand.ts:53` validates path grammar, not tenant ownership. | Replace tenant-named demo options with tenant-scoped asset references and intentionally public platform defaults. Validate ownership on list/select/read, safe MIME/paths, cache scope and audit; no arbitrary URL fetch. Minimal first fix may expose only public defaults until scoped storage exists, clearly labeled. Cross-tenant asset IDs must be rejected. | `branding-assets.spec.ts`, "branding lists only this tenant assets and public defaults". Seed distinct private assets, assert list/name/read/write isolation. Current static demo visibility proves no private-asset breach. |
| UAT-017 P2 · F2/S1 · S | Empty launcher is only a paragraph at `apps/platform/app/tenants/page.tsx:27`. | Shared Empty with sign out, invitation instructions and configured request-access contact. No fake request button or unauthorized self-serve creation. Retain safe invitation continuation and identity context. | `permission-states.spec.ts`, "no-membership user can sign out and find invitation next step"; signed-out boundary still protected. |
| UAT-018 P3 · S1 · M | Branding mutation redirects without result at `apps/platform/app/api/settings/branding/route.ts:86`; page form at `apps/platform/app/settings/branding/page.tsx:55` has no success state. | Shared field/status flow across routine settings, explicit saved/unchanged/error result. Announce after committed write, preserve focus and edited values on failure. Do not infer success from a click or count a 303 as a success message. | `settings-feedback.spec.ts`, "each routine settings save announces committed success or error"; reload confirms persistence and failure leaves retry available. |
| UAT-019 P2 · A1 · M | Raw standalone HTML in `packages/auth-better-auth/src/http.ts:18`, restrictive CSP at line 10, no design-system styling. | Compose host-rendered forms using shared DS fields while preserving the package's provider-neutral HTTP/session contract. Update old GET login target compatibly and retain Origin/CSP protections, no unsafe-inline workaround. Stacked visible labels, adequate targets and full-width controls on mobile. | `better-auth.spec.ts`, "login and signup fit 390px with labels focus and usable targets"; axe target-size plus manual keyboard retry journey. |

## Automated finding coverage

These are shared-cause groups, not 57 separate implementations. Every UX ID is
mapped, including lower-priority diagnostic and nonproduct rows. For confirmed
violations, the named assertion must be red before the fix. For heuristics,
reproduce a visible failure first; if it cannot be reproduced, retain a reviewed
receipt instead of inventing a failing assertion.

| Automated IDs / effort / wave | Located cause | Fix and measurable acceptance | Regression in `tooling/e2e/specs/` |
| --- | --- | --- | --- |
| UX001–UX012, UX024–UX031 · L · 1/3 | Shared palette mismatch: `apps/platform/lib/custom-domains-theme.ts:12`, `apps/platform/app/globals.css:127`, `apps/platform/app/layout.tsx:42`. Affects Assessment dimensions; admin/audit/helpdesk/support; home/tenants; settings overview/modules/activity/navigation/branding/members/domains/connections/identity; brand proposals and ticket detail. | F1 semantic pairs, applied via existing Card/Input/Button and shared page compositions. Tenant-selected primary must include usable on-primary/focus/text roles. Zero `color-contrast` violations on authorized product states across tenant/theme combinations. | `persona-a11y.spec.ts`, "color-contrast has no product violations", one record per persona/route/state/width/theme. |
| UX013, UX017 · M · 1 | Fixed header action rows: `apps/platform/app/admin/page.tsx:30`, `apps/platform/app/page.tsx:91`. | F2 shell with mobile account/menu; sign-out never offscreen. No document overflow at 390, including hostile/long names. | `application-shell.spec.ts`, "admin and launcher controls remain in viewport". |
| UX014–UX016, UX018–UX020, UX033, UX035 · M · 1/3 | Sidebar at `apps/platform/app/settings/layout.tsx:67`, rigid Branding and Navigation fields at respective lines 68 and 54; inline domain label at `apps/platform/app/settings/domains/custom-domains-form.tsx:25`. Other settings repeat the same container contract. | S1 adopts shell/fields; wrap module keys and provider labels, stack actions. ≤1px document overflow, contained tables only, all actions operable. | `settings-mobile.spec.ts`, "settings controls and content shrink within all widths". |
| UX021–UX023 · S · 3 | Scroll wrappers lack keyboard region attributes at `apps/platform/app/admin/audit/page.tsx:64`, `apps/platform/app/admin/helpdesk/page.tsx:69`, `modules/support/src/host-page.tsx:88`. | Reuse ScrollArea/Table, with named focusable scroll region only when needed. Tab reaches it, arrows scroll, visible focus, no trap. Do not solve by clipping table columns. | `admin-accessibility.spec.ts` and `support-accessibility.spec.ts`, "overflow tables are keyboard scrollable"; axe `scrollable-region-focusable`. |
| UX032 · S · 2 | Bare Better Auth form controls at `packages/auth-better-auth/src/http.ts:18`. | A1 shared forms, WCAG 2.2 target-size minimum or valid spacing; adopt 44px touch target as product goal. | `better-auth.spec.ts`, "identity form controls pass target-size" with axe and mobile click checks. |
| UX034, UX036 · M · 2/3 | Assessment rail at `modules/assessment/src/assessment-shell.tsx:208` and uncontained job table at `apps/platform/app/admin/tenants/[tenantId]/page.tsx:21`. | S5 stacks/collapses rail with all 25 dimensions reachable; S2 uses keyboard-accessible table region, long IDs wrap. No body scroll. | `assessment-accessibility.spec.ts`, "mobile rail fits and reaches all dimensions"; `admin-accessibility.spec.ts`, "tenant jobs table stays contained". |
| UX037–UX039 · M · 3 | Placeholder-only client/department/facilitator/respondent fields at `modules/assessment/src/assessment-shell.tsx:155`, line 167 and line 171. Placeholders can supply accessible names, so this is a visible-label diagnostic. | S5 uses shared visible labels for every state, including dimension/results pages; instructions/errors associated, no placeholder dependence. | `assessment-accessibility.spec.ts`, "every assessment input has a visible associated label"; explicit label relationship assertion, not just axe. |
| UX040, UX042 · S · 3 | Focus heuristics, not established absence. Support already specifies focus ring at `modules/support/src/host-ticket.tsx:67`; Assessment uses DS Button. | Inspect computed focus style, pseudo-elements and real Tab traversal after token fix. Correct contrast/geometry only if deficient, do not add duplicate outlines blindly. Visible focus against adjacent surfaces and no obscuring sticky header. | `assessment-accessibility.spec.ts` and `support-accessibility.spec.ts`, "back controls have visible keyboard focus"; screenshot/contrast review attached. Red case required only for confirmed defect. |
| UX043–UX044 · S · 1/3 | Signed-out brand is a div at `apps/platform/app/page.tsx:47`. Assessment already has an h1 at `modules/assessment/src/assessment-shell.tsx:138`, but its loading return at line 96 omits it and `modules/assessment/src/host-mount.tsx:15` disables SSR. This is a loading/hydration seam to reproduce, not a permanently absent Assessment heading. | F2/S5 one meaningful h1 and route-specific metadata, including signed-out pages and Assessment loading/error states; keep a host heading during client loading and avoid duplicating the existing heading once hydrated. | `application-shell.spec.ts`, "signed-out home has a page heading"; `assessment-accessibility.spec.ts`, "assessment has one named page heading". |
| UX046–UX048 · S · 3 | Managed-support denials return null at `apps/platform/app/settings/activity/page.tsx:16`, `apps/platform/app/settings/identity/page.tsx:32` and `apps/platform/app/settings/members/page.tsx:16`. Authorized pages already contain h1s. | S1 renders Access denied with h1, context and exit action. Do not add duplicate headings to allowed states. | `permission-states.spec.ts`, "restricted support settings never render blank main". |
| UX041, UX045, UX053–UX056 · S · 0/6 | Tiny fixture lacks document metadata at `tooling/e2e/upstream.mjs:19`. Sandboxed service-worker exception is a diagnostic to trace, not permission to remove sandboxing. | B0 gives its synthetic HTML title/lang and determines stack/URL source of console exception. Keep opaque-origin sandbox, CSP and cookie stripping. Own fixture exceptions separately from product violations. | `persona-a11y.spec.ts`, "fixture has title and lang" is red today; extend module-proxy spec with "sandbox stays opaque and cannot use service workers". Error attribution requires reproduction, not a blanket console allowlist. |
| UX049–UX052 · S · 6 | Expected text denial uses `apps/platform/app/api/mcp/developer/browser.ts:16`; authorized browserPage already has title/lang at line 15. | Keep API denials as explicit HTTP outcomes, not axe-tested product HTML. Scan the actual authorized consent/confirmation HTML, which must pass title/lang. Optionally make human browser denials shared accessible documents without changing API semantics. | `developer-mcp.spec.ts`, "denials stay denied and valid browser documents have metadata"; raw denial is an expected status, no false red product claim. |
| UX057 · S · 0/6 | Report records a ticket document missing lang, but root normally emits `lang=en` at `apps/platform/app/layout.tsx:42`. Static inspection cannot establish its runtime cause. | B0/V3 preserve response/status/final URL/console evidence and reproduce after shell changes. Fix the demonstrated fallback/error document if present; never suppress html-has-lang on authorized ticket HTML. | `support-accessibility.spec.ts`, "authorized ticket document always has lang and title" at 768 and other widths. Reported red state must be reproduced before claiming closure. |

## Engineering backlog waves

These are the 22 engineering items from the 75-row inventory. The UAT tables
supply detailed criteria for E05–E08/E15. Remaining owner/external rows stay in
the canonical backlog; this plan does not silently convert them to engineering
authority. New Playwright cases complement mandatory service/database tests.

| Backlog / owner / wave / effort | Verified seam and fix approach | Acceptance and regression evidence |
| --- | --- | --- |
| E01 · R1 · 4 · M | `apps/platform/lib/custom-domains.ts:65` persists next_check_at; `packages/domains/src/verification.ts:24` sets 48h validity and 24h next check. `apps/platform/workflows/tenant-worker.ts:83` has no domain schedule. Add bounded due-domain selector and idempotent reverify task. | Simulated time proves checks before expiry, DNS failure deactivates, successful recheck extends validity, concurrent workers do not duplicate claims and expired domains never route. `custom-domains.e2e.spec.ts`, "scheduled DNS loss stops custom-host routing", plus zero-skip DB worker test. |
| E02 · R2 · 4 · L | Helpers `syncMembership`/`syncEntitlement` exist at `packages/authz/src/sync.ts:6` and line 14, but app membership/owner/entitlement mutations lack lifecycle composition. | Durable ordered/idempotent sync of invite acceptance, role change/removal, owner grant, module entitlements and manifest permission snapshots. Revoke before replace; outage/retry cannot retain revoked authority. Tenant-bound local relation-store proof and `authorization-sync.spec.ts`, "role and entitlement revocations take effect after lifecycle mutations"; optional provider contract test does not activate hosted OpenFGA. |
| E03 · R3 · 4 · L | `modules/support/src/email-delivery.ts:57` accepts InMemorySupportDepthStore. Ticket HTTP path does not make that store durable. Reuse existing tenant ticket/outbox transaction and SMTP transport rather than build another mailer. | Persist pending delivery/retry/backoff/idempotency, lease/restart recovery, tenant-local recipients, terminal safe error and retry UI. Mailpit read-back confirms ticket event delivery after worker restart; `support-email.spec.ts`, "ticket email survives worker restart and retries once" plus DB concurrency tests. Do not promise SMTP exactly-once delivery across acknowledgement loss. |
| E04 · V1 · 6 · M | `tooling/ci/db-sequence.mjs:10` inventories suites; mandatory four families are absent. Existing zero-pending assertion at line 47 is the pattern. | Add dedicated database inventory, required envs and expected suite/case counts for custom-domains, key rotation, rate limit and pg observability. Unset URL or missing pgvector fails. `pnpm db:ephemeral -- pnpm ci:db-sequence` executes all with zero skipped/pending and uploads receipts. |
| E05/E06/E07 · F1/F2/S1–S5 · 1/3 · L | Token, shell, title/heading and field causes above. | All UAT/UX mapped cases pass; route-specific title assertions added without assuming every old missing-h1 report was an allowed page. |
| E08 · B0/V1 · 0/6 · M | Current `tooling/e2e/playwright.config.ts:31` has one desktop project, no maintained axe dependency in `tooling/e2e/package.json`; audit was untracked. | Commit inventory, scanner and comparison tests; require complete authorized/denied matrix and no new violations. Details below. |
| E09 · R4 · 4 · L | `apps/platform/lib/tenant-export.ts:50` loads whole tables, line 83 collects whole control tables, line 95 merges both; sink line 42 and download line 102 return whole Buffer. | Paginated/cursor reads and streamed serialization/archive/download with backpressure, cancellation, row/byte/time/disk bounds and partial cleanup. Preserve credential redaction, RLS and 24h expiry. Target peak worker RSS growth ≤128 MiB over warmed baseline for a synthetic ≥1 GiB logical export; document fixture compression and concurrency. `export-bounds.spec.ts`, "large export downloads with bounded size and cleans up on cancel" plus measured process-memory proof. Oversize fails safely and audit records no content. |
| E10 · R5 · 5 · M | `apps/platform/lib/model-router.ts:61` has no production adapters; `modules/brain/src/embeddings.ts:26` is deterministic token hashing. | Implement adapters behind existing router/embedding ports with synthetic HTTP fixtures, typed config, timeout/cancel, dimensions/model/version validation, credential isolation, residency and consent tests. No live provider calls. Unconfigured production is explicit unavailable; no synthetic fallback. |
| E11 · Q1 · 7 · S | Historical README/no-route and capability counts conflict with actual route composition and later proof records. | Reconcile README, requirements/capability docs, stale test totals, Support/Brain UI versus library scope and MCP provider versus route proof. Preserve dated reviews. `pnpm docs:links` has zero failures; public claims reference actual receipts and marketing follow-up only if a later truth-changing implementation lands. |
| E12 · V2 · 6 · M | `apps/platform/app/api/mcp/developer/composition.ts:23` requires actual microsandbox + digest-pinned image. Separate provider lifecycle proof is insufficient. | Actual OAuth/PKCE → tenant-authorized request → required human confirmation → VM execution → destroyed VM → single-use static preview, plus revoke/kill-switch/admission/expiry/egress/secret-negative tests. Extend `developer-mcp.spec.ts`, "callable route executes in real microVM and destroys it before preview". KVM/image absent is failure, not mock or skip. Production remains off. |
| E13 · Q1 · 7 · S | Score rubric requires independent evidence at `docs/plans/2026-11-11-engineering-score.md:14`; no current independent grade. | Fresh-context reviewer recalculates all weighted subscores with local/CI/publication/production columns and receipts. Target ≥4.8, none below 4; report actual score if gates prevent it. Do not infer a numerical increase from test additions. |
| E14 · B0 · 0 · M | E2E run-phase env at `tooling/e2e/run-phase.mjs:32` lacks Mailpit; UAT already provisions it at `tooling/uat/serve.mjs:51`. | Extract reusable bounded local mail fixture with mandatory health/read-back; keep unique names, loopback and cleanup. Signup/invitation browser cases verify delivered link plus actual use, not just direct DB invitation lookup. |
| E15 · S5/V3 · 3/6 · M | Current audits record diagnostic focus/timing; production/export limits lack required browser assertions. | Download CSV/JSON/PDF, parse data, inspect PDF rendering, measure bounds, keyboard focus and CLS. Assessment integrity remains D1; full tenant-export memory remains R4. `assessment.spec.ts` and `production-budgets.spec.ts` enforce real artifacts and fail incomplete/truncated downloads. |
| E16 · R8 · 5 · S | `docs/reviews/2026-11-11-ecs-wave5.md:133` records missing SQL grammar and metadata warnings. | Identify supported local parser/tool versions and repair SQL navigation/metadata without adding runtime deps. Validate known migration-to-store query against source, refresh AST and retain warnings honestly. Integrator regenerates graph after merges; no feature commits of generated graph. |
| E17 · R6 · 5 · M | `modules/support/src/support-ai-service.ts:34` takes in-memory store; accepted behavior is reviewed suggestion only. Follow [composition contract](support-ai-review-composition.md). | Durable suggestion/inference provenance with tenant boundaries, human review, abstention/budget/revocation and retention. Suggestion endpoint never sends reply or changes ticket automatically. `support-ai-review.spec.ts`, "reviewed suggestion persists without mutating ticket"; use synthetic model and contract/red-team fixtures. |
| E18 · R7 · 5 · M | `packages/quality-contract/src/contract.ts:25` defines immutable value, not persistence. [Persistence design](quality-contract-persistence.md) is explicitly proposed, not accepted. | Review/settle design before schema work. Bind immutable contract/evaluation to tenant, module version and sha256 artifact; enforce insert-only/audit/ownership and reject weak/mismatched evidence. Mandatory DB proof, `quality-contract-binding.spec.ts`, "artifact mismatch cannot bind quality evidence" if exposed via host. No Lab/publishing scope expansion. |
| E19 · R6 · 5 · M design first | `docs/product/support-ai-boundary.md:299` says voice conditions nothing customer-facing; `docs/plans/support-ai-review-composition.md:400` requires a new accepted contract. | Prepare separate composed-reply containment proposal and deterministic fixtures. Preferred-word runtime conditioning stays disabled until accepted. Then exact canonical matching, no inflection/synonym inference, banned-word/claim/evidence guards and immutable voice digest. Do not slip it into E17 as an allegedly approved feature. |
| O17 · R8/Q1 · 5/7 · M | `tooling/build/check-packages.mjs` already validates public artifact metadata; owner checklist requires actual target artifacts at `docs/OWNER-TASKS.md:112`. | Generate licence/notices/source obligations/SBOM per release artifact and supported target. Fail incompatible licence/unattributed copy; local package proof first. No public publish. |
| O19 · R8/Q1 · 5/7 · M | `docs/OWNER-TASKS.md:117` retains blocked final public-history/security review. | Audit final candidate history and artifact list with redacted findings, secret/identifier/tenant-data/security checks. Preparation is engineering work; owner approves public release. Do not print suspected secrets in receipts. |
| O27 · R8 · 5 · M | `tooling/provisioning/src/app-role.ts:61` and line 65 embed generated password in SQL; provider-specific helper needs separate composition. | Implement provider-neutral credential-rotation port plus Neon adapter contract from reviewed API docs, preserving Postgres-local path and all non-BYPASSRLS grants. Synthetic API tests prove no password SQL/logs on Neon path and recoverable encrypted-checkpoint update. Actual provider test remains account/operation gated; do not claim live proof from mocks. |

## Regression and UAT regime

### CI matrix and a limit that only tightens

B0/V1 makes the persona × viewport × axe scan a maintained CI job. Pin
`@axe-core/playwright` exactly in the E2E package through the integrator; the
old scratch run used 4.11.0 with axe-core 4.11.4, which is evidence of that run,
not an instruction to silently use a floating package version. Retain its WCAG
2 A/AA, 2.1 A/AA and 2.2 AA tags.

1. Register every new spec in the correct identity phase: `tooling/e2e/playwright.config.ts:7` currently hard-codes seven journey filenames, and unlisted specs run in the local-identity phase. New BA/claim/a11y specs must not silently execute under LOCAL_USERS. Add collection-count and expected-provider assertions, then commit the route/state inventory and authorization expectation table, with
   the six scan personas: signed out, installation owner, tenant owner, admin,
   member and managed support. Add no-memberships and pending-owner journeys as
   explicit behavior cases. Use 390×844, 768×1024 and 1440×900. Preserve the
   original 630 combination identifiers or document an exact inventory delta;
   fail missing, duplicate, timed-out or unexecuted cells. Do not require 630
   successful content loads when most disallowed pages should deny/redirect.
2. Use real provisioner/migrations, separate tenant databases and Better Auth
   memberships. Assert intended response, final URL, role and content before
   axe. Separate expected API errors/stub HTML from product documents. Scan real
   permitted consent forms; do not call every 403 an accessibility exemption.
3. Start with reviewed fingerprints for existing violations:
   persona + tenant/theme + route/state + viewport + axe rule + stable target.
   Normalize disposable UUIDs, never normalize away tenant or role. New
   fingerprint, worse impact or higher affected-node count fails. The baseline
   can only shrink after a fix; raising it requires an explicit reviewed
   exception with owner/reason/expiry, never an automatic overwrite.
4. Target zero serious and critical findings, required before Q1 passes. Once
   zero is reached, it is a hard failure threshold. During repair, the initial
   comparison gate prevents new violations without mislabeling existing P1s as
   passing UAT. Keep incomplete axe results for manual review. No blanket rule
   exclusions and no arbitrary retry that drops failed evidence.
5. Add document overflow ≤1px, visible labels, title/h1, keyboard navigation,
   focus review and download validity assertions. Keep expected denial receipts
   separate from successful content coverage. Store rule/impact/target and
   sanitized response/error details, not only screenshots or totals.
6. Batch bounded route sets with one browser worker per server and restart
   between batches. The earlier dev audit exhausted 6 GB/3 GB/6 GB attempts;
   8 GB V8 within a 12 GB job was a workaround, not a proven required product
   allocation. Record peak RSS and batch time, use built mode where practical,
   fail OOM/connection-refused cells and run cleanup in finally/CI always steps.
   Upload sanitized matrix JSON, comparison, timings and redacted screenshots.
   Raw traces/cookies and the UAT manifest stay private, never public artifacts.

E04 adds mandatory env-gated suites to the existing DB sequence and exact
passed/total/pending assertions. Use `pnpm db:ephemeral -- <command>` with
`pgvector/pgvector:0.8.2-pg17-bookworm`, a unique container and a random loopback
port other than 5432. Missing extension/URL is a failed proof. CI receipts must
show suite identity and executed counts, not merely a green generic test job.

### BrowserOS Neo runbook on the owner's Mac

This is the proposed execution procedure. Starting the longer-lived UAT unit
requires owner approval of its worktree, ports, lifetime and synthetic scope.
This planning commit does not start it.

- On Linux, use Node 22/pnpm 11.13.1 and preloaded pinned Postgres/Mailpit images.
  Start `pnpm uat:serve --better-auth` in the approved managed unit. Keep all
  listeners on loopback, production/provider credentials excluded and fixtures
  synthetic. Read `.uat/manifest.json` privately; never print tokens, cookies,
  invitation links, owner-claim files or environment contents into chat/logs.
- A Codex agent on the owner's Mac drives BrowserOS Neo. Open an agent-owned
  tab group named `OpenTenant UAT YYYY-MM-DD`; do not use the user's existing
  tabs, signed-in accounts or saved sessions. Use the supported isolated browser
  profile/context where available. If Neo shares the user's cookie store, use
  the run's unique localhost port/hosts and only synthetic UAT identities;
  never treat the user's session as a test credential. Use fresh isolated
  contexts for cross-tenant assertions and sign out/clear only test origins.
- Read the manifest's SSH command through a private channel and forward only
  app and Mailpit ports, preserving exact local/remote numbers. Use the host's
  approved SSH/Tailscale route. Browse `http://alpha.localhost:<app-port>` and
  other manifest hosts, not a public domain. No DB/SMTP/DNS-control/Next
  internal-port forwarding. Do not paste token-bearing URLs into findings.
- Run the 15 scripts below at 1440 and 390 with the actual seeded ten personas
  and seven tenants. Refresh element references after navigation. Capture
  keyboard behavior and responsive screenshots; inspect ARIA plus actual
  screen-reader announcements for errors/status where possible. Record if
  speech was not checked. Provisioning retry and TXT activation use run-local
  controls, not external services. Hostile data must remain inert.
- Findings use the original form: stable ID, priority, category, route and final
  URL with secrets stripped, persona/tenant alias, viewport/build/SHA, steps,
  expected/actual, safe root-cause hypothesis/confidence, screenshot/artifact
  path and proposed fix. Reuse UAT IDs for regressions, add IDs for new issues.
  Record pass/fail/blocked per journey and width. A blocked journey is not pass.

| Journey | Required script and proof |
| --- | --- |
| 1. Signed out, hosts and unknown host | Open all seven tenant hosts and unknown.localhost. Verify sign-in/appropriate suspended state, generic unknown 404, no stack overlay or cross-tenant details. |
| 2. Cross-tenant private-data boundary | Alpha/Beta owners in separate contexts cannot read other's tickets, Assessment, settings or private brand assets. Public defaults deliberately remain public. |
| 3. Admin overview and audit | Installation owner opens all overview/audit controls, filters and keyboard-scrollable table; member is denied with useful next step. |
| 4. Onboarding and provisioning | Create unique synthetic tenant, observe automatic status changes; inject bounded local failure and retry; owner invitation reaches Mailpit. |
| 5. Lifecycle and export | Suspend/resume, assert API 423; export/download/expiry; cancel deletion confirmation, then confirm and undo within retention. Restore exact initial fixture state. |
| 6. Managed support | Operator starts reason/reference-bound session, banner and expiry visible, allowed routine configuration succeeds, restricted action explains denial, exit returns safely. |
| 7. Tenant settings | Exercise overview, members, identity-unavailable, domain challenge reissue/failed/successful local DNS, connections-unavailable, branding proposal/policy, module/navigation/activity. Every save has status. |
| 8. Support tickets and states | Create/reply, all five states, priority/assignment/history and keyboard access; durable mail read-back without revealing recipient credentials. |
| 9. Assessment, exports and restore | Complete 25 questions for A=3, New engagement B=4, check distinct respondents and aggregates, parse CSV/JSON, inspect PDF, restore A and verify reload. |
| 10. Pending-owner claim | From real synthetic email: signup or existing-account login, accept invitation, separate private claim token, one owner-grant job; replay/wrong identity rejected. |
| 11. Fresh tenant pages | Home, settings and modules have useful empty/unavailable states and return navigation. No fabricated data or success. |
| 12. Hostile tenant | Stored hostile brand/text render inert, safe colors/fonts, no injection/network escape, long strings fit both widths. |
| 13. Member permissions | Member/admin allowed operations work, owner removal protection remains, denied settings explain restrictions without exposing data. |
| 14. No memberships | Launcher explains invitations/access contact and permits sign-out; no automatic membership or tenant creation. |
| 15. Better Auth forms | Valid and invalid signup/login, retry after error, invitation context, origin protection, mobile labels/targets/focus, logout and stale-session rejection. |

Fixture version 2 includes private PNG assets `asset_uat_alpha` and
`asset_uat_beta` at `/api/settings/branding/assets/<asset-id>`. Use separate
Alpha/Beta owner contexts and copy only the synthetic test session to each
manifest host to prove the other tenant's asset returns 404 everywhere. Each
owner's own host returns 200. `/opentenant-logo.svg` stays public. The database
snapshot includes asset metadata and bytes; `uat:reset` restores both exactly.

Tester allowed commands over SSH, from the approved stack's owning worktree:

```sh
pnpm uat:status
pnpm uat:control --help
pnpm uat:control status
pnpm uat:control fail-next-provision
pnpm uat:control fail-next-provision <new-synthetic-slug>
pnpm uat:control clear
pnpm uat:control expire-exports <tenant-slug>
pnpm uat:reset
```

For Journey 4, arm the default `uat-provision-retry` slug, create it through
the product with synthetic owner details and region `eu`, then wait for
`Retry job`. The real provisioner fails naturally on a conflicting local
migration-tracking table. `status` reports failed after five attempts. Run
`clear`, click `Retry job`, and verify active/completed without reloading.
The conflict remains until clear; clear preserves the product checkpoints.
It removes an unused fixture database when no tenant was created. These
controls refuse a foreign/stopped stack, non-loopback targets or service
Postgres. They change UAT fixtures only, with no production code path changes.
See [operator controls](../../tooling/uat/README.md) for the exact guards.

For Journey 5, create an export and verify its download, then run
`pnpm uat:control expire-exports alpha` for the exported tenant's slug.
Retry the original URL and verify 404. The control moves only that tenant's
existing archive expiries into the past in the disposable control database.
Other tenants and newly created exports retain their normal expiry. The same
ownership, running-stack and loopback guards apply. The receipt contains only
the run ID, slug and updated archive count. No product code changes are needed.

### Bounded UAT service and reset verification

The two-hour limit explains why the BrowserOS run's final reset checks did not
execute. It does not establish a failed application reset. Sources confirm
SIGTERM cleanup at `tooling/uat/serve.mjs:21` and line 129, parent-death guardian
at line 38, and label-scoped `uat:down` at `tooling/uat/down.mjs:43`. Keep those
protections. An agent background task is not an appropriate owner for a long
manual session.

B0 provides a reviewed user-level systemd unit/template with explicit
WorkingDirectory, run/worktree name, `RuntimeMaxSec` and `TimeoutStopSec`,
`KillMode=control-group`, `UMask=0077`, no automatic restart, cleanup invoking `pnpm uat:down`,
and a sanitized status record containing expiry/ports/unit name but no tokens.
Use a 6-hour session by default only when approved, within the Forge 24-hour
maximum, with a 30-minute expiry warning. On Forge, prefer its existing
`forge-job run --seconds 21600 opentenant-uat-<run> -- pnpm uat:serve --better-auth`
under that owner-controlled lifecycle, retain the printed unit and foreground
wait. Do not detach it merely to evade the two-hour policy. Redirect stdout to
a private mode-0600 run file because `tooling/uat/serve.mjs:120` prints the
credential-bearing manifest today. Keep service journal output token-free;
B0 should add a sanitized startup-summary option with private manifest default.

A tmux session is an alternative only on hosts whose policy permits it and
with owner approval, a real TTL, an EXIT/TERM cleanup trap and the same
`uat:down`/port verification. A bare detached tmux/nohup process on Forge would
violate the local workload policy. The managed systemd option is the primary
proposal here. No lingering or permanent service is authorized by this plan.

Replace the missing final reset proof with explicit checkpoints:

1. B0 records a private initial fixture snapshot: tenant lifecycle flags,
   memberships/invites, brand-policy versions, ticket counts/states, domain
   claims and run-owned jobs/resources. Browser storage is a separate snapshot,
   since Assessment uses localStorage. Export any test-created data needed for
   reproduction before resetting it.
   Fixture version 2 includes private raster bytes and metadata. Reset also
   removes provisioning-control records and their run-created databases.
2. During each mutating journey, register compensations and verify restored
   values immediately, before service expiry. Add `uat-reset.spec.ts`, "UAT
   reset restores fixtures before shutdown and fresh start is clean". Undo
   deletion and wait for jobs before restoring data, not afterward. Catch failed
   compensation as a failure with safe stage code; do not swallow it.
3. For Assessment, clearing DB alone cannot reset the browser. The gateway at
   `tooling/uat/runtime.mjs:109` seeds only when the engagement key is absent.
   Clear only the agent's test-origin storage/cookies, re-open the private
   persona link and assert initial engagement ID/respondent count, fresh empty
   tenant and no previous-run responses. Re-sign-in without clearing is a
   persistence test, not a reset test.
4. Capture sanitized pre-stop pass/fail receipt while alive, then stop the exact
   unit, run `pnpm uat:down` twice to prove idempotence, verify it inactive and
   recorded listeners closed, run labels absent, manifest/control lock deleted,
   and `forge-job audit` clear of own leftovers. Preserve unrelated resources.
5. Restart once in a new bounded run: new run ID/credentials, baseline counts,
   no old created tenant/domain/ticket/Assessment state. Test expired old UAT
   sign-in link rejection without printing either token. Stop/clean again.
   Add Node lifecycle tests for normal stop, forced launcher death and TTL.

### Production performance budgets

Use `pnpm uat:serve --start --build` with its real BA database fixtures for
compiled route measurements. Built UAT currently requires HTTPS for real
identity form POST/sign-out (`packages/auth-better-auth/src/http.ts:99`);
HTTP persona switching is not proof of production identity forms. B0/V3 must
provide a reviewed loopback TLS front proxy/trust setup for those tests without
changing app production checks. Keep the dev DNS stub out of built production
configuration; use an injected local resolver only in a separate service test,
and approved local DNS infrastructure for a full built domain browser proof.

Proposed initial lab budgets, to freeze after B0 measures the baseline on a
recorded Node/browser/CPU/memory profile:

| Metric | Initial gate and method |
| --- | --- |
| Home, settings, Navigation, admin, Support, Assessment route readiness | Warm p95 navigation-to-visible h1/usable primary control ≤2s, 20 samples per route; separately cold first navigation ≤5s over five fresh starts. Include tenant host/role, no compilation time in warm samples. |
| Rendering | Mobile lab LCP ≤2.5s, CLS ≤0.1 using full session-window measurement, maximum scripted interaction delay ≤200ms. Label these lab figures, not field p75 INP. Use a fixed documented CPU/network profile. |
| Payload | Initial route JS ≤300 KiB gzip for shell/settings; ≤500 KiB for Assessment including charts/export entry. Load expensive export/PDF code on demand. No >10% regression from reviewed baseline while bringing oversized routes under target. |
| Resources | Per-batch peak RSS and teardown reported; no unbounded growth across repeated route batches. Tenant export has its own R4 memory/disk/time proof. |

Unlike contrast and the Assessment bug, current source/report evidence does not
show these proposed latency gates failing. Record first results honestly,
profile measured misses, then set the mandatory limits. Do not manufacture
"fails today" performance evidence from dev-mode numbers.

### Exit criteria and handoff

UAT passes only when all 15 journeys pass on both 1440 and 390, none is blocked,
there are no open P1 findings, and authorized product HTML has zero serious or
critical axe findings across the CI matrix. No-new-violation comparison alone
is not UAT pass. Approved unavailable states may pass for intentionally disabled
providers; a broken invitation or inaccessible brand workflow may not be
renamed unavailable. All lower-priority reported UX defects must be resolved
or explicitly accepted with evidence before claiming every journey passes.

Every implementation item supplies red/green regression evidence, exact SHA,
owned-path diff, test counts with skip reasons, screenshots/download artifacts
where applicable, and wiring requested from the integrator. Run relevant tests,
`pnpm turbo typecheck lint test`, platform build and `git diff --check` after
meaningful code changes. Before implementation handoff run repository-scoped
Gitleaks and Semgrep, Trivy for dependencies/containers/IaC/deployment changes,
production audit with zero high/critical, `pre-commit run --all-files` if its
config exists, and relevant Promptfoo evals if the project adds that config.
`pnpm docs:links` must report zero failures. Update Graphify locally after code;
only the integrator regenerates/commits generated output after merging.

ECS is a separate exit. Waves 1–3 primarily raise UAT pass rate; waves 0/6 add
critical journey/CI evidence toward maturity and DX; V2 adds AI route evidence;
R1 adds white-label reliability. Wave 7 regrades from receipts, including current
env-lint proof rather than stale presumed gaps. Public provenance can raise
maturity only after the owner release gate and real npm provenance receipt.
Licence, production usage and design-partner history remain outside agent work.

## Owner decisions recorded 2026-11-15

| Question | Decision | Effect on execution |
| --- | --- | --- |
| Execution scope | Run waves 0–7 | Agents execute the whole plan, pausing only at owner gates. |
| Licence and npm | Prepare the Apache-2.0 split for module-facing contracts, keep the operating layer AGPL, publish only after counsel sign-off | A licence-split change is prepared but not released; OWNER-NPM-RELEASE-01 stays pending. |
| Git | Push and open one PR for the integrated work now; each later wave lands as its own follow-up PR | Every wave must pass CI on GitHub before the next one stacks on it. |
| UAT stack | tmux session on the Linux host with an 8-hour TTL, loopback only | Replaces agent background jobs for BrowserOS re-runs. |
| Visual design | Fix within the current shadcn/Tailwind look | Wave 1 repairs token pairs and the shell; no palette or typography redesign. |
| Brain (UAT-013) | Build a minimal UI: search, recent decisions, signals, empty states, behind the existing entitlement | Brain gets a UI item in wave 3 instead of an unavailable state. |
| Assessment (UAT-014) | General-purpose wording; legacy recovery moves to an advanced recovery view | Wave 3 copy and IA changes. |

## Owner decisions and what they unblock

| Decision | Unblocks |
| --- | --- |
| Licence/steward/counsel and source provenance | Public legal release and any Apache-core relicense discussion; current AGPL/Apache-SDK/docs licences remain in force. Not needed for local UX fixes. |
| OWNER-NPM-RELEASE-01 | Namespace/version, public visibility, protected environment and trusted publishing; first real public npm provenance receipt. Local Verdaccio/dry run remains usable now. |
| OWNER-DEVELOPER-MCP-02 | Exact production callable route after V2's actual route proof and protected-resource/admission/preview/confirmation/kill-switch evidence. Local synthetic route proof proceeds before this approval. |
| OWNER-KVM-CI-01 / hosted runner KVM | Approved runner with working /dev/kvm and required GitHub microVM proof receipt. Missing KVM remains failure. Does not approve production sandboxes. |
| Production accounts/origins/regions/keys, retention/restore, provider scope | Live identity, DNS/hosting, mail/model/embedding/sandbox/observability/metering integration and genuine tenant data, within exact approved scope. O02/O34 Slack, O04/O37 compliance and O05 billing remain separate named gates in the canonical backlog. |
| Design-partner gate | Synthetic UAT is followed by a nominated, approved production partner only after isolation, restore, identity and operational gates; permits actual adoption evidence, not a manufactured maturity score. |

C01–C06 are receipt collection, not new implementations: KVM, SMTP, release,
create-opentenant/dx-timed, restore-drill and release-local-proof. Obtain first
successful GitHub receipts for the exact final revision when remote execution
is authorized, starting release with its default dry run. Do not push, dispatch,
publish or change protections merely because this planning document lists them.
Other backlog O/D entries remain deferred, conditional or external as labeled;
this short owner table does not replace or erase their canonical checklists.

## Corrections to carry into execution

- Contrast affected 329 scan instances, not all 630. Automated overflow differs
  from the manual run's measured widths because these are different runs.
- UAT-007 has both active-tenant binding and absent BA operation grants to
  investigate. Installation authority alone was never the proposal contract.
- Unknown .localhost names can currently resolve to the default development tenant. The new host regression must distinguish the real app boundary from UAT gateway filtering and test both fixture host families.
- UAT-010 remains application-versus-fixture unknown. Existing successful
  generic invitation E2E does not prove pending-owner claim end to end.
- UX044 does not mean Assessment permanently lacks an h1: it already has one, hidden behind its client-only/loading path. Several managed-support missing-h1 reports are actual null denial states.
- UAT-016 demonstrates a globally offered static demo logo/name, not a proved
  private-asset disclosure. Tenant-scoped asset tests are still required.
- Final BrowserOS reset checks were not run before expiry. The automated report
  separately records successful audit cleanup; do not conflate the two runs or
  claim a reproduced reset-function bug.
- E18's referenced design says Proposed for review. E19's composed-reply
  acceptance is absent; the accepted boundary explicitly prohibits current
  voice conditioning. Review/design preparation can proceed, runtime behavior
  must follow the resulting accepted contracts.
- The current env-lint already has family coverage and explicit accepted
  obfuscation residuals. A new DX gap needs a failing accidental-read fixture or
  missing CI receipt, not reimplementation of protections already present.
- The supplied ECS checkpoint and never-run GitHub assertions lack independent
  receipts in this checkout. Preserve them as supplied context with these
  limits; record a new score/run state only after independent verification.

## Planning verification

At the source baseline, all explicit file:line references were read back and
checked with `rg`. `pnpm docs:links` reports 0 failures. `git diff --check`
passes. Repository-source Gitleaks reports zero leaks with generated dependency,
build and graph output excluded. Semgrep's two local rules report zero findings
on 900 source files, with existing partial-parse warnings in Archify utilities
and `modules/support/src/support-ai.ts`; this is a limited scan, not a broad
security assurance. No pre-commit or Promptfoo configuration exists here.
No application tests or UAT were executed for this documentation-only change.
Graphify AST refresh retained the missing SQL grammar and nine metadata warnings;
its generated files are excluded from this planning commit.
