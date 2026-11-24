# Unattended development ledger

Date: 2026-07-20

Branch: `codex/unattended-development-20260720`

Initial scope: safe local work only. Later owner authorizations permit the
recorded branch push and bounded development-provider probes. Genuine tenant
data and production enablement remain prohibited.

This is the durable execution ledger for the current unattended run. Status is
updated as evidence changes; `docs/HANDOFF.md` remains the resume point.

## U-01 — Repository knowledge and licensing checkpoint

- **Status:** completed
- **Lane:** spec
- **Objective:** preserve the completed documentation reorganisation, Graphify
  setup, and split licensing decision in verified local checkpoints.
- **Source:** owner requests to organise the repository, install a knowledge
  graph helper, and adopt the recommended protective licence model.
- **Acceptance criteria:** stable docs index and paths; locally reproducible
  graph workflow; `AGPL-3.0-only` core, `Apache-2.0` module SDK, and
  `CC-BY-SA-4.0` docs; no secret, provider identifier, or third-party code
  copied into the repository.
- **Assumptions:** all current dirty files were created by this development
  run; canonical licence texts and SPDX metadata remain unchanged.
- **Files in scope:** repository policy files, licence files and manifests,
  `docs/**`, `.graphifyignore`, `.gitattributes`, `.gitignore`, and
  `graphify-out/**`.
- **Risks and mitigations:** legal conclusions remain subject to counsel;
  dependency provenance remains explicitly preliminary; an independent diff
  review and deterministic licence hashes precede commit.
- **Verification:** licence hash checks; workspace licence metadata scan;
  Markdown-link check; `pnpm turbo typecheck lint test`; platform build;
  `git diff --check`; independent diff review.
- **Evidence:** `docs/legal/2026-07-20-dependency-licence-inventory.md`,
  `graphify-out/GRAPH_REPORT.md`.
- **Commit:** `a62775c`.
- **Blockers or gaps:** final legal/provenance review remains in
  `docs/OWNER-TASKS.md`.

## U-02 — Settle hosted provider direction

- **Status:** completed
- **Lane:** spec
- **Objective:** make the owner-selected WorkOS, Vercel, and Neon stack
  explicit without weakening provider-neutral contracts or authorising cloud
  operations.
- **Source:** owner decision on 2026-07-20.
- **Acceptance criteria:** hosted identity/authorization targets WorkOS;
  hosting and hosted sandbox target Vercel; hosted PostgreSQL targets Neon;
  accounts, IDs, credentials, regions, spend, live probes, and production
  approval remain runtime/owner concerns.
- **Assumptions:** Vercel includes the existing Vercel Sandbox target described
  in the accepted PRD and ADR.
- **Files in scope:** architecture, PRD, handoff, owner tasks, and provider
  runbooks.
- **Risks and mitigations:** provider lock-in stays behind current contracts;
  wording explicitly retains production safety gates.
- **Verification:** focused stale-language scan; Markdown-link check; Graphify
  refresh after the documentation batch.
- **Evidence:** `docs/architecture/platform-architecture.md`,
  `docs/architecture/adr-005-developer-mcp-sandbox-adapter.md`.
- **Commit:** `a62775c`.
- **Blockers or gaps:** test accounts, commercial plan, region, cost ceiling,
  and production approval remain owner tasks.

## U-03 — Enforce the platform production build in CI

- **Status:** completed
- **Lane:** fix
- **Objective:** close the gap between the accepted CI contract and the actual
  workflow.
- **Source:** `docs/architecture/adr-001-monorepo-foundation.md` and
  `docs/architecture/platform-architecture.md`; the audited workflow omitted
  the platform build.
- **Acceptance criteria:** the main CI check runs
  `pnpm turbo build --filter=@opentenant/platform` after the existing checks;
  the same command passes locally on Node 22.
- **Assumptions:** build output is deterministic and needs no provider keys.
- **Files in scope:** `.github/workflows/ci.yml` and behavioral regression
  evidence only.
- **Risks and mitigations:** increased CI time is limited to one already
  required production build; no workflow permissions change.
- **Verification:** prove the workflow lacks the step, add the minimal step,
  run the build, `pnpm run check`, YAML inspection, and `git diff --check`.
- **Evidence:** Node `v22.23.1`, pnpm `11.13.1`; platform build passed with 21
  static pages and the existing edge-runtime warning; all 51 monorepo
  lint/typecheck/test tasks passed.
- **Commit:** `a62775c`.
- **Blockers or gaps:** none.

## U-04 — Add missing deterministic design-system coverage

- **Status:** completed
- **Lane:** fix
- **Objective:** cover established brand-host and class-merge behavior through
  public exports without changing product behavior.
- **Source:** untested deterministic helpers in
  `packages/design-system/src/lib/brand.ts` and `lib/utils.ts`.
- **Acceptance criteria:** tests cover valid/invalid hostname resolution,
  allowed override behavior, the synthetic fixture identity, and class
  conflict merging; every package with established Vitest coverage fails if
  its test files disappear; package tests and typecheck pass.
- **Assumptions:** existing helper behavior is the accepted contract.
- **Files in scope:** one new design-system public-export test and the test
  scripts of packages that already contain Vitest tests. Type-only
  `module-sdk` and placeholder `testing` retain `--passWithNoTests`.
- **Risks and mitigations:** avoid visual/component scope and implementation-
  structure assertions.
- **Verification:** targeted package test/lint/typecheck, recursive workspace
  tests, manifest inventory, and diff inspection.
- **Evidence:** design-system 4/4 tests passed; recursive workspace execution
  passed 267 tests. All 14 packages with Vitest test files now use strict
  `vitest run`; the two intentional zero-test packages retain the opt-out.
- **Commit:** `9a1d6a3`.
- **Blockers or gaps:** none.

## U-05 — Developer MCP Phase 2 slice

- **Status:** completed
- **Lane:** spec
- **Objective:** implement the smallest fully specified, fail-closed identity
  prerequisite for the WorkOS-authenticated Developer MCP without exposing a
  route, tool, or sandbox operation.
- **Source:** handoff priority and FR-001/FR-002 of the Developer MCP PRD.
- **Acceptance criteria:** add a provider-neutral bearer-token verifier and
  active tenant-binding seam; reject missing/malformed/invalid, wrong-audience,
  org-less, delegated/impersonated, unmapped, inactive, and cross-tenant
  principals; return internal user/tenant IDs only; grant no permission,
  expose no tool, and import no sandbox code.
- **Assumptions:** provider selection is settled, but exact WorkOS group
  mappings are not.
- **Files in scope:** `packages/auth/src/developer-mcp.ts`, its behavioral
  tests, auth exports, and a WorkOS verifier adapter only if its JWT behavior
  can be proven locally with synthetic keys.
- **Risks and mitigations:** token audience, tenant binding, and permission
  ambiguity fail closed; defer any slice whose public contract is unspecified.
- **Verification:** RED/GREEN auth package tests, synthetic signed-token tests
  for any provider adapter, package gates, tenant-binding/error-path evidence,
  and independent review. HTTP route execution remains excluded.
- **Evidence:** RED proved missing neutral and WorkOS verifier modules. GREEN:
  54 auth tests pass, including exact single-audience, issuer, signature,
  expiry, subject/organisation shape, delegated/impersonated denial, explicit
  active membership, provider failure, and cross-tenant cases. Auth typecheck
  and lint pass on Node 22. Independent security review findings were fixed
  and the focused re-review passed.
- **Commit:** `0992bd4`.
- **Blockers or gaps:** exact group mapping, initial permission vocabulary,
  FGA launch model, and tool/resource schemas still block a successful tool or
  sandbox path. This slice authenticates and binds identity only.

## U-06 — Developer MCP Phase 0 threat model

- **Status:** completed
- **Lane:** spec
- **Objective:** document the concrete trust boundaries, assets, attacker
  capabilities, abuse paths, risks, mitigations, detection, and manual-review
  focus for the planned Developer MCP.
- **Source:** Developer MCP PRD Phase 0 exit criteria and risk register.
- **Acceptance criteria:** repository evidence anchors every major claim;
  current versus planned surfaces are distinct; WorkOS, Vercel, Neon, preview,
  audit, package supply chain, and CI boundaries are covered; unresolved owner
  decisions remain explicit.
- **Assumptions:** internet-facing MCP and previews are planned but not live;
  development remains synthetic-data-only; no provider account is selected.
- **Files in scope:** `docs/security/developer-mcp-threat-model.md` and the docs
  index.
- **Risks and mitigations:** avoid generic or inflated threats by defining
  attacker non-capabilities and calibrating current risk against the absent
  route; do not convert conditional future mitigations into delivered claims.
- **Verification:** evidence-path review, Markdown links, Mermaid syntax
  inspection, independent security-document review, and `git diff --check`.
- **Evidence:** `docs/security/developer-mcp-threat-model.md`.
- **Commit:** `ffd7d43`.
- **Blockers or gaps:** owner answers may change rankings; update the model when
  permissions, FGA, quotas, publication, or genuine-data scope is approved.

## U-07 — Final graph and durable handoff refresh

- **Status:** completed
- **Lane:** fix
- **Objective:** refresh generated architecture navigation and leave factual
  resume records after all material work is stable.
- **Source:** `RTK.md` Graphify workflow and repository handoff convention.
- **Acceptance criteria:** `graphify update .` and `graphify check-update .`
  pass; graph counts/evidence in HANDOFF match the generated report; HANDOFF,
  SHIPLOG, OWNER-TASKS, and this ledger match actual commits and verification.
- **Assumptions:** Graphify remains AST-only with no model backend or token
  cost.
- **Files in scope:** `graphify-out/**` and durable project records.
- **Risks and mitigations:** refresh only after material edits settle; review
  generated changes before commit.
- **Verification:** Graphify commands, focused query, `git diff --check`, and
  goal-truth audit.
- **Evidence:** `graphify-out/GRAPH_REPORT.md`; focused query and explain output
  for `DeveloperMcpTenantBinding` and `WorkOSDeveloperMcpTokenVerifier`; forced
  uncached verification of all 51 monorepo tasks and 296 tests; forced platform
  build with 21 static pages.
- **Commit:** final documentation and graph checkpoint (this checkpoint).
- **Blockers or gaps:** none for the local unattended run. Provider probes,
  deployment, publication, and the successful Developer MCP tool path remain
  intentionally owner-gated.

## U-08 — Fail-closed passcode verification

- **Status:** completed
- **Lane:** fix
- **Objective:** ensure hostile or corrupted stored scrypt strings are rejected
  as invalid instead of throwing or requesting attacker-selected work factors.
- **Source:** `RTK.md` hostile-input rule and the public `verifyPasscode`
  malformed-input contract; reproduced with canonical-looking invalid scrypt
  parameters.
- **Acceptance criteria:** non-canonical parameters, invalid numeric fields,
  invalid salt/hash encodings, and incorrect decoded lengths return `false`;
  valid current hashes and wrong-passcode behavior remain unchanged.
- **Assumptions:** the only accepted persisted format is the format emitted by
  `hashPasscode` with the current fixed parameters.
- **Files in scope:** `packages/security/src/index.ts` and its public behavior
  tests.
- **Risks and mitigations:** avoid an unbounded compatibility surface by
  matching the single established encoder exactly; never call scrypt until
  parsing and decoded lengths are bounded.
- **Verification:** focused RED/GREEN tests, security lint/typecheck/test,
  monorepo regression checks, and independent review.
- **Evidence:** RED reproduced `ERR_OUT_OF_RANGE` and invalid-scrypt-parameter
  throws. GREEN passed 24 security tests plus package lint and typecheck on
  Node `v22.23.1` and pnpm `11.13.1`.
- **Commit:** `d409c77`.
- **Blockers or gaps:** none.

## U-09 — Membership-link ownership integrity

- **Status:** completed
- **Lane:** fix
- **Objective:** reject an existing WorkOS membership reference when its
  persisted tenant or user owner conflicts with the caller's context.
- **Source:** the ownership invariant in migration
  `0004_membership_ownership.sql`; audit reproduced a store path that returned
  a membership ID after `coalesce` silently preserved another owner.
- **Acceptance criteria:** exact ownership is idempotent; null ownership may be
  enriched; non-null tenant or user conflicts throw a generic error; conflict
  winners are validated atomically before return; membership references require
  a user while invitations may remain temporarily unowned.
- **Assumptions:** membership ownership is immutable after it becomes known;
  invitations may initially have a null user owner.
- **Files in scope:** `packages/database/src/control-plane-stores.ts` and a
  focused public-store test.
- **Risks and mitigations:** preserve current race handling and avoid exposing
  external IDs in errors; use one validation rule for existing and race-winner
  rows.
- **Verification:** RED/GREEN database tests, database lint/typecheck/test,
  auth gateway regression tests, monorepo checks, and independent review.
- **Evidence:** RED reproduced silent tenant/user conflict accepts and a
  membership reference without a user owner. GREEN passed 23 database tests,
  database lint and typecheck, plus all 54 auth regression tests on Node 22.
- **Commit:** `d409c77`.
- **Blockers or gaps:** none.

## U-10 — Approved sandbox template digest enforcement

- **Status:** completed
- **Lane:** fix
- **Objective:** prove that bytes written into a sandbox match the approved
  template digest before any provider workspace is created.
- **Source:** the sandbox foundation plan's immutable approved-template and
  content-digest requirements; audit reproduced that the orchestrator trusted
  a caller-supplied, syntactically valid digest without recomputation.
- **Acceptance criteria:** deterministic path-and-byte hashing matches the
  built-in template; a mismatched digest is denied before `adapter.create`;
  the exact verified byte snapshots are subsequently written; errors expose
  neither file contents nor digest values.
- **Assumptions:** the documented digest algorithm is SHA-256 over sorted path,
  NUL, contents, NUL records.
- **Files in scope:** sandbox template/orchestrator sources and focused tests.
- **Risks and mitigations:** copy mutable byte arrays once before hashing and
  writing to prevent check/use drift; retain provider-neutral contracts.
- **Verification:** RED/GREEN sandbox tests, sandbox lint/typecheck/test,
  monorepo checks, and independent review.
- **Evidence:** RED proved mismatched bytes completed the full lifecycle. GREEN
  rejects before provider creation and preserves the verified byte snapshot;
  all 83 sandbox tests plus sandbox lint and typecheck pass on Node 22.
- **Commit:** `d409c77`.
- **Blockers or gaps:** none.

## U-11 — Frozen-install synthetic template

- **Status:** completed
- **Lane:** fix
- **Objective:** make the approved synthetic fixture structurally compatible
  with its required `pnpm install --offline --frozen-lockfile` command.
- **Source:** Developer MCP PRD dependency-pinning and mandatory-lockfile
  requirements; the approved template currently contains no lockfile or
  package-manager/runtime pin.
- **Acceptance criteria:** the fixture contains a deterministic no-dependency
  `pnpm-lock.yaml`, declares pnpm `11.13.1` and Node 22, retains only synthetic
  files, and passes an offline frozen install when materialised locally.
- **Assumptions:** the synthetic fixture intentionally has no dependencies;
  its placeholder build/test commands are exercised by adapter conformance,
  not executed on the host.
- **Files in scope:** `packages/sandbox/src/template.ts` and its focused tests.
- **Risks and mitigations:** do not add dependencies or execute generated code;
  verify only package-manager lockfile resolution in a disposable directory.
- **Verification:** RED/GREEN template tests, disposable offline frozen install,
  sandbox package gates, monorepo checks, and independent review.
- **Evidence:** RED proved the lockfile and runtime/package-manager pins were
  absent. GREEN passed five template tests and a one-off exact pnpm `11.13.1`
  offline frozen install with scripts disabled; the full 83-test sandbox suite,
  lint, and typecheck pass. The package-manager subprocess is intentionally not
  part of the routine unit suite because launcher verification can require
  network access in restricted environments.
- **Commit:** `d409c77`.
- **Blockers or gaps:** none.

## U-12 — Tenant RLS transaction-helper coverage

- **Status:** completed
- **Lane:** spec
- **Objective:** add direct behavioral proof that the exported tenant database
  helper scopes `app.tenant_id` to a transaction and safely releases clients.
- **Source:** platform architecture verification requirements and the exported
  `withTenantContext` contract; the integration RLS proof sets context directly
  and does not exercise this application boundary.
- **Acceptance criteria:** success proves begin, transaction-local tenant
  context, callback, commit, returned value, and healthy release in order;
  callback failure rolls back; rollback failure destroys the client while
  preserving the original error.
- **Assumptions:** a fake `PoolClient` is sufficient for application sequencing;
  real PostgreSQL RLS policy remains covered by the separate CI proof.
- **Files in scope:** `packages/database/src/tenant-locator.test.ts` only unless
  the behavioral proof exposes a production defect.
- **Risks and mitigations:** assert observable query/release order without
  reproducing PostgreSQL policy semantics in a mock.
- **Verification:** focused database tests, lint/typecheck, monorepo checks,
  diff inspection, and independent review.
- **Evidence:** all 23 database tests pass, including ordered success, callback
  rollback, rollback-failure destruction, and original-error preservation;
  database lint and typecheck pass on Node 22.
- **Commit:** `d409c77`.
- **Blockers or gaps:** local Docker integration remains a separate evidence
  profile.

## U-13 — Final integration and graph refresh

- **Status:** completed
- **Lane:** fix
- **Objective:** prove the combined unattended changes and refresh every durable
  resume surface against the resulting commit.
- **Source:** repository quality gates and Graphify workflow.
- **Acceptance criteria:** forced uncached monorepo checks and platform build
  pass; Graphify is refreshed and structurally valid; HANDOFF, SHIPLOG, owner
  tasks, and this ledger match the committed state; worktree is clean.
- **Assumptions:** Docker-backed RLS remains earlier CI evidence because the
  local Docker socket is unavailable in this sandbox.
- **Files in scope:** durable project records and portable Graphify artifacts.
- **Risks and mitigations:** generated graph files are reviewed by counts,
  dangling-edge validation, secret scan, and focused queries before commit.
- **Verification:** Node/pnpm versions; forced Turbo checks; forced platform
  build; Graphify update/check/query; Markdown links; secret patterns; graph
  JSON integrity; `git diff --check`; independent reviews.
- **Evidence:** forced uncached run passed 51/51 tasks and 317 tests; forced
  platform build passed with 21 static pages and the existing edge-runtime
  warning.
- **Commit:** final documentation/graph checkpoint (this checkpoint).
- **Blockers or gaps:** Docker-backed RLS and membership concurrency were not
  rerun locally; no live provider, route, sandbox, or cloud probe was permitted.

## Goal-truth audit for U-08 through U-13

- **Verified:** malformed passcode parameters and non-canonical encodings fail
  closed before scrypt; valid/current hashes retain behavioral coverage.
- **Verified:** membership references require an internal user and one atomic
  upsert rejects conflicting tenant/user ownership without returning an ID or
  exposing provider identifiers.
- **Verified:** sandbox template paths/bytes/reference metadata are snapshotted,
  deterministically hashed, and rejected before provider creation on mismatch;
  no new generated-code execution surface was added.
- **Verified:** the synthetic template includes a no-dependency frozen lockfile
  and exact Node/pnpm pins; its one-off install ran offline with scripts disabled.
- **Verified:** `withTenantContext` tests assert transaction-local tenant
  binding, commit/rollback/release order, broken-client destruction, and original
  error preservation through the exported application boundary.
- **Verified:** no provider SDK, account/team/project/region/domain, credential,
  customer identity, or genuine tenant data was introduced; `.env` was neither
  read nor staged.
- **Verified:** forced uncached monorepo checks, platform build, graph integrity,
  local Markdown links, secret patterns, and diff whitespace gates pass.
- **Verified:** HANDOFF, SHIPLOG, OWNER-TASKS, and this ledger preserve the
  owner-gated Developer MCP permissions/schema/FGA boundary.
- **Uncertain:** real PostgreSQL conflict arbitration and RLS policy were not
  rerun locally because the Docker socket is unavailable; unit/SQL review and
  earlier CI evidence pass, but no new runtime claim is made.
- **Uncertain:** WorkOS, Vercel, and Neon behavior was not live-probed; no
  provider or production claim is made.
- **Blocked:** non-built-in template approval authenticity requires an
  owner-approved server-side registry before any caller-facing template
  selection is exposed; current code exposes no such route.

## U-14 — Publish the governed baseline for review

- **Status:** completed
- **Lane:** owner-authorised operation
- **Objective:** push the completed feature branch and open a reviewable pull
  request without merging or deploying it.
- **Source:** owner authorization on 2026-07-20.
- **Acceptance criteria:** clean intended branch pushed to `origin`; draft PR
  targets `main`; body records scope, validation, and exclusions.
- **Files in scope:** no repository edits required for the initial operation.
- **Risks and mitigations:** draft status preserves review; no force push,
  merge, release, or deployment.
- **Verification:** GitHub authentication, remote/default-branch inspection,
  push output, and PR readback.
- **Evidence:** draft PR #1 on the configured GitHub `origin`.
- **Commit:** existing branch commits through `77bc444`.
- **Blockers or gaps:** review and merge remain owner-controlled.

## U-15 — Local Docker and PostgreSQL proof

- **Status:** completed
- **Lane:** fix/verification
- **Objective:** replace earlier CI-only database evidence with a live local
  PostgreSQL migration and RLS proof.
- **Source:** owner authorization to install/open Docker and repository quality
  gates.
- **Acceptance criteria:** only OpenTenant Compose resources touched; service
  healthy on loopback; migrations pass twice; synthetic seed and application
  role are correct; all RLS checks pass.
- **Files in scope:** no repository edits; `compose.yaml`, migrations, and
  `tooling/ci/rls-proof.mjs` are exercised.
- **Risks and mitigations:** Compose `.env` loading disabled, checked-in local
  credentials used, and unrelated containers/volumes left untouched.
- **Verification:** Docker 29.1.5, Compose 5.0.1, PostgreSQL 17.10; 11 control
  migrations; two successful migration runs; all 13 RLS checks pass.
- **Evidence:** local command output and the checked-in RLS proof.
- **Commit:** final evidence checkpoint.
- **Blockers or gaps:** none; the local service remains running.

## U-16 — Minimal Vercel Sandbox live probe

- **Status:** completed with gaps
- **Lane:** owner-authorised operation
- **Objective:** test the selected hosted sandbox using the smallest bounded
  cloud mutation and deterministic cleanup.
- **Source:** owner authorization to use the ignored Vercel account credential.
- **Acceptance criteria:** REST only; no deployment or Git link; empty test
  project; Node 22, 1 vCPU/2 GB, deny-all egress requested, no ports/secrets,
  60-second timeout; one synthetic command; cleanup; identifier-free durable
  evidence.
- **Files in scope:** architecture evidence and durable records only; temporary
  probe scripts remain outside the repository.
- **Risks and mitigations:** provider responses reduced to statuses/booleans;
  project cleanup runs after failure; no provider IDs or URLs persisted.
- **Verification:** account/team HTTP 200; project and sandbox HTTP 200;
  structured command HTTP 200 with expected marker; stop HTTP 200; project
  deletion HTTP 204; zero residual test projects.
- **Evidence:**
  `docs/architecture/evidence/2026-07-20-vercel-sandbox-live-probe.md` and its
  adjacent sanitized JSON result record.
- **Commit:** final evidence checkpoint.
- **Blockers or gaps:** named deletion after non-persistent stop and team-wide
  sandbox listing returned HTTP 400 for undetermined reasons; runtime egress
  enforcement, region, price, retention, snapshots, previews, artifacts, SDK
  composition, and production use are unverified.

## U-17 — Technical licence and provenance review

- **Status:** completed with counsel gates
- **Lane:** spec
- **Objective:** replace the preliminary dependency inventory with a
  reproducible repository, history, asset, licence-boundary, and installed-
  dependency review suitable for counsel handoff.
- **Source:** owner request on 2026-07-20 and publication owner task.
- **Acceptance criteria:** trace licence scopes and history; inspect assets,
  copied/vendor indicators, dependency metadata/notices/integrity, conditional
  licences, and public-release gaps; remediate objectively unsafe findings;
  never claim automated legal sign-off.
- **Files in scope:** legal/governance docs, package-manager resolution, one
  unreferenced asset, and durable records.
- **Risks and mitigations:** technical conclusions are explicitly separated
  from rights ownership, trademark, and counsel decisions; platform-specific
  closure is not generalized to future artifacts.
- **Verification:** 18 manifest licences; 618 installed/577 production records;
  exact conditional dependency paths; registry integrity metadata; reachable-
  history and copied-code scans; frozen install; production audit; link and
  secret-pattern checks.
- **Evidence:**
  `docs/legal/2026-07-20-technical-licence-provenance-review.md` and
  `THIRD_PARTY_NOTICES.md`.
- **Commit:** final evidence checkpoint.
- **Blockers or gaps:** legal entity, pre-import rights attestation, trademark
  clearance, artifact-specific notices/SBOM, contributor agreement, and
  qualified counsel review remain owner-controlled.

## U-18 — Follow-up integration and PR evidence

- **Status:** completed
- **Lane:** fix
- **Objective:** validate, review, graph, commit, and push the authorized
  follow-up evidence and remediations to draft PR #1.
- **Acceptance criteria:** dependency audit clean; relevant and full repository
  gates pass; Graphify and durable records match the result; worktree clean;
  PR body/checks reflect the new evidence.
- **Files in scope:** all U-15 through U-17 evidence/remediation files and
  generated portable graph artifacts.
- **Verification:** forced Turbo checks, platform production build, local RLS,
  Graphify update/check/integrity, Markdown links, secret patterns,
  `git diff --check`, and independent review.
- **Evidence:** forced uncached validation passed 51/51 tasks and 317 tests;
  forced platform build passed with 21 static pages; production audit reports
  no known vulnerabilities; graph has 2,491 nodes, 4,651 edges, and zero
  dangling relationships.
- **Commit:** final follow-up checkpoint (this checkpoint).
- **Blockers or gaps:** Neon live deployment/data-plane testing remains a
  separate bounded task; WorkOS development setup is recorded in U-19.

## U-19 — WorkOS AuthKit development setup

- **Status:** completed
- **Lane:** owner-authorised operation
- **Objective:** use the owner-attested dedicated WorkOS development account to
  configure and verify the minimum existing OpenTenant AuthKit boundary.
- **Source:** owner supplied ignored credentials, nominated the account for
  OpenTenant, and authorized required API-side development configuration.
- **Acceptance criteria:** secrets remain ignored and undisclosed; the exact
  localhost callback is registered; established adapter role slugs exist;
  OpenTenant reaches hosted AuthKit; callback failures disclose no provider
  detail and set no cookie; no user, membership, tenant organisation,
  permission, domain, or production setting is created.
- **Assumptions:** the owner's explicit fresh-account attestation establishes
  the development-only environment boundary. API inventory observed no users
  but did not independently prove the provenance of existing organisations or
  permissions, which remain untouched and unclaimed.
- **Files in scope:** ignored `.env`; WorkOS development environment roles and
  callback; sanitized evidence and durable project records. Temporary setup
  scripts remain outside the repository.
- **Risks and mitigations:** API/provider responses are reduced to booleans,
  counts, status codes, and known role slugs; local callback validation is
  exact; no permission vocabulary or tenant mapping is invented.
- **Verification:** account inventory and idempotent role readback; callback
  registration and idempotent readback; real local `GET /auth/login`; hosted
  authentication HTTP response; missing/invalid callback error paths; auth and
  platform checks; full repository gates; secret scan; Graphify refresh; PR CI.
- **Evidence:**
  `docs/architecture/evidence/2026-07-20-workos-authkit-development-setup.md`.
- **Commit:** final WorkOS evidence checkpoint (this checkpoint).
- **Blockers or gaps:** the authenticated-user gap was closed by U-21.
  Production origins, abuse controls, group mapping, permissions, FGA, and
  genuine tenant use remain owner-gated.

## Goal-truth audit for U-19

- **Verified:** `.env` contains all four required WorkOS settings, the cookie
  password meets the minimum length, and none is tracked or printed.
- **Verified:** account readback contains both established custom environment
  roles; the idempotent second pass created no roles.
- **Verified:** the exact existing localhost callback is registered; the
  idempotent second registration reported it already existed.
- **Verified:** OpenTenant's public login route reaches hosted AuthKit with the
  expected callback and state, and provider redirects end on an HTML
  authentication surface.
- **Verified:** missing and invalid callback codes return generic 400/401
  responses; provider details and session cookies are absent.
- **Verified:** this setup added no tracked SDK import or provider setup script,
  and no account/resource ID or secret entered tracked files.
- **Verified by U-20:** the pre-existing tenant-provisioning SDK import was
  removed and its provider operations now cross the narrow auth port.
- **Verified by U-21:** successful user authentication, sealed-session handling,
  active membership, application-role mapping, and tenant binding pass through
  the real hosted callback with temporary synthetic objects.
- **Blocked:** Developer MCP permission slugs, group mapping, tool/resource
  schemas, and FGA remain explicit owner decisions and were not inferred from
  provider defaults.

## U-20 — Close the tenant-provisioning WorkOS boundary

- **Status:** completed
- **Lane:** spec
- **Objective:** remove the pre-existing direct WorkOS SDK dependency from the
  platform tenant route without changing provisioning behavior.
- **Source:** `RTK.md` provider-boundary rule, the SDK boundary comment, and the
  independent U-19 diff review.
- **Acceptance criteria:** tenant organisation creation and compensating
  deletion cross a typed auth-package port; only the auth adapter imports the
  WorkOS SDK; the platform package drops its direct SDK dependency; established
  create/rollback ordering is preserved by source review, adapter forwarding is
  covered, and the platform builds.
- **Assumptions:** provider organisation IDs remain private adapter values and
  the existing transaction/compensation sequence is the accepted contract.
- **Files in scope:** WorkOS port/SDK adapter and tests, tenant admin route,
  platform manifest, lockfile, and durable records.
- **Risks and mitigations:** preserve the exact create-before-transaction and
  delete-on-local-failure ordering; return only the external ID through the
  provider-specific port; reject malformed or unbounded provider IDs; use
  synthetic test values.
- **Verification:** focused auth tests; auth/platform typecheck and platform
  tests; exact SDK import scan; lockfile-only offline install; forced monorepo
  checks and production build; Graphify; diff/secret/integrity review.
- **Evidence:** `packages/auth/src/workos/sdk.test.ts`,
  `apps/platform/app/api/admin/tenants/route.test.ts`, and the source import
  scan. The final forced uncached monorepo run passed 51/51 tasks and 325 tests;
  the forced platform production build generated all 21 pages with only the
  established edge-runtime warning.
- **Commit:** provider-boundary checkpoint (this checkpoint).
- **Blockers or gaps:** the route still needs an authenticated synthetic
  end-to-end tenant-provisioning exercise before any live hosted tenant is
  created; that exercise also depends on an approved Neon test scope.

## U-21 — Successful synthetic WorkOS tenant session

- **Status:** completed
- **Lane:** owner-authorised operation
- **Objective:** close the U-19 authenticated-user gap by proving the real
  hosted AuthKit callback, sealed session, active WorkOS membership, and local
  control-plane tenant binding with temporary synthetic resources.
- **Source:** U-19 goal-truth audit and the owner's standing authorization to
  use the dedicated WorkOS development account for required setup/testing.
- **Acceptance criteria:** a temporary email-verified synthetic user and
  organization authenticate through hosted AuthKit; the callback sets the
  secure session cookie; the application renders the mapped synthetic tenant
  and user; provider and local resources are deterministically removed; no
  secret or provider identifier enters tracked files or durable evidence.
- **Assumptions:** a temporary provider organization, membership, and user in
  the owner-attested development environment are within the approved bounded
  test scope; the local PostgreSQL control plane is sufficient because this
  slice does not exercise tenant data-plane provisioning.
- **Files in scope:** the unattended ledger, sanitized WorkOS evidence, handoff,
  ship log, and owner-task status. Runtime-only synthetic provider objects and
  local database rows are excluded from the repository.
- **Risks and mitigations:** use a unique `example.test` identity and synthetic
  display values; do not print credentials or object identifiers; create no
  domains, permissions, provider projects, or paid capacity; verify exact
  organization/role binding; revoke sessions and delete only objects created by
  this probe; remove local rows in dependency order.
- **Verification:** provider readback; browser-driven hosted sign-in and local
  callback; authenticated application HTML and cookie attributes; local
  account-link/tenant-binding readback; cleanup readback; focused auth/platform
  checks; full repository gates; Graphify refresh; diff and secret review.
- **Runtime evidence:**
  `docs/architecture/evidence/2026-07-20-workos-authkit-development-setup.md`.
  Browser automation returned to `/`, observed the expected sealed-cookie
  attributes, rendered the synthetic tenant/settings surface, and readback
  proved the exact non-platform-admin account link and tenant mapping. Cleanup
  removed one session, membership, user, organization, local user/link, and
  local tenant; final synthetic counts were zero.
- **Relevant commits:** successful WorkOS session checkpoint (this checkpoint).
- **Blockers or gaps:** Neon tenant provisioning remains a separate task gated
  by the still-unset maximum incremental spend and approved provider region.

## U-22 — Local default-tenant pool initialization

- **Status:** completed
- **Lane:** fix
- **Objective:** restore the established localhost default-tenant path when no
  normalized tenant host has initialized the resolver first.
- **Source:** U-21 runtime attempt: `GET /` returned HTTP 500 because
  `currentTenant()` dereferenced the module-level pool while it was still null.
- **Acceptance criteria:** plain localhost plus `PLATFORM_DEFAULT_TENANT_ID`
  resolves the active tenant through an initialized control-plane pool; host
  and override resolution behavior remains unchanged.
- **Assumptions:** the configured control-plane URL is the established source
  for every resolver path and a single lazy pool remains appropriate.
- **Files in scope:** `apps/platform/lib/tenant.ts`, its behavioral regression
  test, and durable records.
- **Risks and mitigations:** centralize lazy pool construction rather than add
  a caller-side guard; exercise the exported `currentTenant()` entry point with
  the exact localhost/default-tenant inputs that failed at runtime.
- **Verification:** confirm the regression test fails with the observed null
  dereference, implement the smallest root-cause fix, rerun platform tests and
  the real application path, then run the repository quality gates.
- **Runtime evidence:** the pre-fix Next.js request returned HTTP 500 at
  `apps/platform/lib/tenant.ts` while reading `pool.query`; after the fix the
  same real application path returned HTTP 200 and completed hosted sign-in.
- **Relevant commits:** local tenant initialization fix (this checkpoint).
- **Blockers or gaps:** none known.

## Goal-truth audit for U-21 and U-22

- **Verified:** only uniquely named synthetic WorkOS and local objects were
  created; no Neon/Vercel resource, domain, permission, or genuine data was
  used.
- **Verified:** hosted AuthKit returned through the real callback and the
  browser received one non-empty sealed session cookie with the required
  security attributes.
- **Verified:** the application rendered the mapped synthetic tenant and
  tenant settings; provider and control-plane readback proved an active
  `tenant-owner` membership, exact organization mapping, one account link, and
  no platform-admin elevation.
- **Verified:** teardown revoked the observed session and final API/database
  readback found zero synthetic users, organizations, tenants, or account rows.
- **Verified:** the localhost regression failed with the original null-pool
  symptom before production code changed, passes after the shared lazy-pool
  fix, and the real request changed from HTTP 500 to HTTP 200.
- **Uncertain:** live Neon tenant provisioning remains untested because maximum
  incremental spend and an approved provider region are still unset.
- **Blocked:** Developer MCP permission/schema/group/FGA decisions remain owner
  tasks and were not inferred from this identity proof.

## U-23 — US Neon tenant provisioning live proof

- **Status:** completed
- **Lane:** owner-authorised operation
- **Objective:** close the hosted data-plane verification gap with the approved
  synthetic test-tenant identity, US region, and zero-incremental-spend boundary.
- **Source:** the owner's 2026-07-20 approval of US Neon testing and an
  owner-controlled domain as the synthetic test tenant.
- **Acceptance criteria:** use the real provider adapter and orchestration path;
  create one project at a time on the existing free plan; migrate tenant core;
  create a non-privileged application role; prove forced fail-closed RLS and
  exact context; delete every project; retain no credential or provider ID.
- **Assumptions:** the development organization's reported `free` plan permits
  a zero-incremental-spend probe; the approved domain names the test boundary
  but does not authorize genuine tenant data or DNS changes.
- **Files in scope:** sanitized architecture evidence and durable records. The
  live harness was temporary and removed after execution.
- **Risks and mitigations:** unique deterministic names; no retry of ambiguous
  create requests; synthetic tenant data only; no WorkOS/Vercel/domain mutation;
  cleanup in every path; active and recoverable inventory after deletion.
- **Verification:** Node 22 live adapter/orchestration execution; owner/app role
  SQL; forced-RLS metadata; missing/exact context queries; provider deletion and
  inventory; package tests/typecheck; full repository gates; Graphify refresh.
- **Runtime evidence:**
  `docs/architecture/evidence/2026-07-20-neon-tenant-live-probe.md`.
- **Relevant commits:** Neon live-proof checkpoint (this checkpoint).
- **Blockers or gaps:** zero active resources remain, but six deleted probes are
  visible inside Neon's provider-managed recovery window. Production retention,
  PITR, restore/export, incident response, and deletion-expiry evidence remain
  unapproved.

## U-24 — Pin verified TLS for Neon connection URIs

- **Status:** completed
- **Lane:** fix
- **Objective:** prevent pg's announced v9 `sslmode=require` behavior from
  weakening Neon hostname verification.
- **Source:** the dependency security warning emitted by U-23's real
  connection.
- **Acceptance criteria:** fresh and resume-path URIs use
  `sslmode=verify-full`; unrelated provider query parameters survive; malformed
  URIs fail generically without echoing credentials; a real Node 22 connection
  uses an encrypted client TLS socket.
- **Assumptions:** Neon PostgreSQL endpoints must always use verified TLS.
- **Files in scope:** Neon adapter, behavioral tests, and durable evidence.
- **Risks and mitigations:** normalize only the TLS-mode query parameter at the
  provider boundary; preserve all other URI parts; catch URL parsing errors and
  replace them with a fixed safe message.
- **Verification:** RED reproduced unchanged `sslmode=require`; GREEN covers
  create, resume, parameter preservation, and safe malformed input; package
  test/typecheck passed; a temporary US project connected using `verify-full`,
  completed `select 1`, reported an encrypted client socket, and was deleted.
- **Runtime evidence:**
  `docs/architecture/evidence/2026-07-20-neon-tenant-live-probe.md`.
- **Relevant commits:** verified-TLS checkpoint (this checkpoint).
- **Blockers or gaps:** none in the adapter; broader production database policy
  remains owner-gated.

## Goal-truth audit for U-23 and U-24

- **Verified:** the Neon organization reported plan `free`, zero projects at
  preflight, and the approved US project region.
- **Verified:** the real adapter and orchestration created/migrated the tenant,
  established a least-privilege app role, forced RLS, failed closed without
  context, and returned exactly one tenant with the correct context.
- **Verified:** every created project was deleted; final inventory reported zero
  active projects and six recoverable deleted probes, all in `aws-us-east-1`.
- **Verified:** no WorkOS organization, Vercel project, deployment, DNS record,
  provider identifier, credential, or genuine tenant data entered the diff.
- **Verified:** both Neon connection-URI paths pin `verify-full`; the live
  Node 22 client reported an encrypted TLS socket and the earlier pg warning was
  absent.
- **Blocked:** hosted custom-domain activation requires a dedicated subdomain
  of the owner-approved namespace plus DNS, Vercel binding, WorkOS callback, and verified
  readback; neither live apex was modified.

## U-25 — Clerk complete-alternative identity provider

- **Status:** completed
- **Lane:** spec
- **Objective:** add Clerk as a complete per-deployment alternative to WorkOS
  for browser authentication, tenant organization lifecycle, and member
  administration while preserving local and WorkOS behavior.
- **Source:** owner-approved Clerk provider design and test/demo application
  scope on 2026-07-20.
- **Acceptance criteria:** one deployment selects exactly one identity provider;
  Clerk native sessions become explicitly tenant-bound internal sessions;
  provider identifiers remain inside adapter/store seams; canonical roles and
  allowlisted permissions fail closed; sign-in, sign-up, organization switch,
  signed-in identity, and sign-out controls are visible; WorkOS/local regression
  gates remain green; demo resources are cleaned up with sanitized evidence.
- **Assumptions:** the linked Clerk application and credentials are development
  and demo resources only; custom roles must be assigned to its active Role Set;
  no domain, production, paid-plan, or genuine-data change is authorized.
- **Files in scope:** `packages/auth`, identity control-plane stores,
  `apps/platform` identity/session/middleware/auth/settings surfaces, tests,
  provider-neutral configuration docs, durable records, and Graphify outputs.
- **Risks and mitigations:** Clerk request context is obtained only through
  `await auth()` and `getToken()`; the adapter verifies the token and active
  session; all tenant-sensitive callers pass an expected tenant; external IDs
  leave neither forms nor audits; unknown providers/roles/permissions fail
  closed; SDK imports remain at adapter/composition boundaries.
- **Verification:** vertical RED/GREEN package and route tests; auth/database/
  platform typecheck and lint; provider-specific builds; local runtime paths;
  browser-driven demo proof; cleanup readback; full Turbo gates; independent
  diff review; secret/provider-ID scans; Graphify refresh and integrity checks.
- **Evidence:**
  `docs/superpowers/specs/2026-07-20-clerk-auth-provider-design.md` and
  `docs/superpowers/plans/2026-07-20-clerk-browser-admin-provider.md`.
- **Relevant commits:** design checkpoint `f9885f5`; implementation plan
  `419fe0d`; provider-scoped persistence slice `c61db84`; normalized member
  administration slice `6998631`; Clerk gateway and shared conformance slice
  `ecbde0c`; independent-review hardening `4dfed3e`; Clerk Backend API
  boundary `3de63bb`; SDK independent-review hardening `5f75a21`; request
  composition `9825509`; pre-auth request sanitization `8403cf4`; browser auth
  controls and provider-dispatched routes `b0ccc74`; provider-neutral
  administration `9793e59`; CLI publishable-key compatibility `180a1a4` and
  browser configuration `e62ec89`; provider-neutral tenant/owner invariants
  `c266915`; additive tenant-metadata compatibility `b2eec76`; and invitation-
  role plus concurrent owner-removal hardening `2fbad42`.
- **Current evidence:** Clerk and WorkOS pass the shared authenticated,
  expired, invalid, impersonated, missing/inactive membership, and logout
  cases; the auth package passes 113 tests and strict type checking. Ambiguous
  Clerk membership ownership fails closed before access or mutation. The
  independent review's mixed-status ambiguity, conflicting membership-key,
  wrong-subject listing, and cross-origin login findings are fixed; the fresh
  post-SDK suite passes 105 tests. The backend boundary validates v1/v2 claims,
  issuer/party/audience, active-session/profile readback, bounded pagination,
  scoped mutations, idempotent invitations, and fixed redacted failures. The
  SDK review's mandatory-audience, per-tab organization, duplicate-page,
  profile-email, and mutation-response findings are fixed.
  Platform auth composition and browser controls pass 72 tests and strict type
  checking. Fresh local, WorkOS, and Clerk-configured Next production builds
  each complete with 21 static-generation entries; middleware host validation
  and reserved-header stripping occur before Clerk authentication. Clerk sign
  in/up, organization switching, user identity, and native sign-out controls
  are provider-conditional; native sign-out returns through an app-owned
  cleanup route without manipulating a Clerk provider cookie.
  Provider-neutral provisioning/member/portal behavior passes selected-provider
  SQL binding, compensation, internal-ID audit, canonical last-owner, and
  mixed-tenant denial tests. External identity-provider organization IDs now
  stop at the control-plane mapping seam; additive migration `0002` removes the
  legacy tenant-data column without changing migration `0001`, and old-schema
  retries are covered. Invited or suspended owners cannot defeat the
  last-active-owner invariant; cross-process PostgreSQL advisory locking
  serializes the complete list/check/delete section, and pending invitation
  role mismatches fail closed. Fresh local/WorkOS/Clerk runtime smoke checks pass;
  real-browser evidence at ignored local paths shows both signed-out controls
  and the hosted Clerk sign-in modal. The demo Clerk audience claim has verified
  readback and no user/organization resource was created. The final uncached
  profile passes all 51 tasks and 436 tests; a live two-connection PostgreSQL
  proof confirms the transaction advisory lock blocks until the first owner
  mutation commits.
- **Blockers or gaps:** active-organization signup/member browser proof requires
  owner approval of the custom Clerk roles' System Permissions before those
  roles are added to the Primary Role Set and Organizations are enabled. The
  separate Clerk Developer MCP verifier and successful tool route retain the
  design's permission/schema/FGA approval boundary.

## U-26 — Unknown-host home null dereference

- **Status:** completed
- **Lane:** fix
- **Objective:** preserve the generic unknown-host 404 without logging a
  null-tenant server-component exception.
- **Source:** local runtime verification during U-25.
- **Acceptance criteria:** `Home()` invokes the Next not-found boundary before
  tenant-dependent work when resolution returns null; no session lookup occurs.
- **Assumptions:** layouts and pages may render concurrently, so the page cannot
  rely on the root layout's earlier `notFound()` call.
- **Files in scope:** `apps/platform/app/page.tsx` and its public-component test.
- **Risks and mitigations:** duplicate the security boundary, not tenant state;
  preserve the existing generic response and add no fallback tenant.
- **Verification:** RED reproduced the `Cannot read properties of null` symptom;
  GREEN passes 59 platform tests, strict type checking, and the real unknown-host
  request returns 404 without the exception.
- **Evidence:** behavioral test in `apps/platform/app/page.test.tsx`; runtime
  status/log check; commit `5f52379`.
- **Blockers or gaps:** none.

## U-27 — Optional Vercel operator MCP boundary

- **Status:** completed
- **Lane:** spec
- **Objective:** support Vercel's official MCP as an optional operator-only
  diagnostic integration without making it an OpenTenant runtime dependency or
  weakening tenant-facing MCP boundaries.
- **Source:** owner-approved recommendation following review of the overlap
  between Vercel MCP and the planned Developer MCP.
- **Acceptance criteria:** document the official remote OAuth endpoint and local
  Codex setup; distinguish operator diagnostics from Developer and Brain MCP;
  classify read-only, confirmation-required, and prohibited tools; commit no
  credentials, account/resource identifiers, deployment URLs, or client config.
- **Assumptions:** each template adopter chooses and authorizes their own Vercel
  account and accepts the beta terms; the repository does not manage that OAuth
  lifecycle.
- **Files in scope:** the operator runbook, documentation index, owner tasks,
  handoff, ship log, execution ledger, and refreshed Graphify artifacts.
- **Risks and mitigations:** Vercel OAuth inherits the operator's account access,
  logs/previews may contain secrets or prompt injection, and the server exposes
  state-changing tools. Keep OAuth outside the application; scope reads; treat
  responses as hostile; require confirmation for access links, Toolbar writes,
  and every read call; prohibit unattended CLI, deployment, domain, and
  purchase operations.
- **Verification:** official endpoint/setup/tool reference readback; local
  Markdown link check; provider identifier and credential-pattern scans;
  `git diff --check`; Graphify update and integrity check.
- **Evidence:** `docs/runbooks/vercel-operator-mcp.md` and this ledger entry.
- **Relevant commits:** operator MCP documentation checkpoint (this checkpoint).
- **Blockers or gaps:** no Vercel OAuth connection or live provider call is
  required for this policy/documentation slice. Provider tool availability may
  change while the service remains beta and must be checked before use.

## U-28 — GitHub Actions Node 24 runtime compatibility

- **Status:** completed
- **Lane:** fix
- **Objective:** remove GitHub's deprecated Node 20 action-runtime warnings
  before the hosted runner removes that compatibility path.
- **Source:** successful PR run `29767563833` emitted Node 20 deprecation
  annotations for checkout, Node/pnpm setup, and secret scanning.
- **Acceptance criteria:** every affected action is pinned to a verified,
  immutable upstream release commit whose manifest declares `node24`; workflow
  behavior remains green; the replacement run has no Node 20 annotation.
- **Assumptions:** GitHub-hosted `ubuntu-latest` satisfies the candidate actions'
  minimum runner version; the workflow uses none of the changed major-version
  surfaces identified in the upstream release notes.
- **Files in scope:** `.github/workflows/ci.yml`, durable records, and refreshed
  Graphify artifacts.
- **Risks and mitigations:** major action upgrades are supply-chain and behavior
  changes. Use official repositories only, exact verified commit SHAs, inspect
  each `action.yml` runtime and release notes, preserve all inputs, and require a
  successful pull-request run before completion.
- **Verification:** YAML parse, pin/runtime/provenance readback, focused diff
  review, `git diff --check`, and the complete hosted `check` plus `rls-proof`
  jobs without the prior warning.
- **Evidence:** GitHub run `29767563833` for RED; replacement run `29768154177`
  passed both jobs, produced zero check annotations, and contains no Node 20
  runtime warning.
- **Relevant commits:** Node 24 action-pin checkpoint `3be308e`.
- **Blockers or gaps:** none. Future action upgrades still require the same
  immutable-pin and upstream-provenance review.

## U-29 — Fail-closed tenant provisioning inputs

- **Status:** completed
- **Lane:** fix
- **Objective:** reject ambiguous or unsupported data-region and brand-policy
  inputs before any tenant lookup, provider call, database write, or hosted
  provisioning action.
- **Source:** security audit of the platform-admin tenant creation route.
- **Acceptance criteria:** only exact `us` or `eu` regions and canonical brand
  keys are accepted; invalid input receives a deterministic redirect and has
  no side effects; public-route behavioral tests reproduce both original
  failures and pass after the fix.
- **Assumptions:** the existing brand-key grammar is the repository contract;
  region aliases and implicit defaults are not supported by the form endpoint.
- **Files in scope:** tenant admin POST route, its behavioral tests, and durable
  records.
- **Risks and mitigations:** validate before constructing the control-plane pool
  so malformed requests cannot touch privileged dependencies.
- **Verification:** focused RED/GREEN route tests, platform typecheck/lint/test,
  full repository gates, diff review, and Graphify refresh.
- **Evidence paths:** `apps/platform/app/api/admin/tenants/route.test.ts`.
- **Relevant commits:** fail-closed tenant input checkpoint (this checkpoint).
- **Blockers or gaps:** none known.

## U-30 — Atomic tenant activation evidence

- **Status:** completed
- **Lane:** fix
- **Objective:** commit tenant activation and its `tenant.provisioned` audit
  evidence in one control-plane transaction.
- **Source:** architecture invariant that privileged state and evidence commit
  together where applicable.
- **Acceptance criteria:** activation and success audit use one client and
  transaction; audit failure rolls back activation; the client is released;
  failure auditing is best-effort and cannot replace the generic response.
- **Assumptions:** external tenant-database provisioning remains resumable and
  is deliberately outside the control-plane transaction.
- **Files in scope:** tenant admin POST route, its behavioral tests, and durable
  records.
- **Risks and mitigations:** keep the transaction narrow and retain provisioning
  status on every local failure.
- **Verification:** focused RED/GREEN route tests, package gates, diff review,
  and full repository validation.
- **Evidence paths:** `apps/platform/app/api/admin/tenants/route.test.ts`.
- **Relevant commits:** atomic activation-evidence checkpoint (this checkpoint).
- **Blockers or gaps:** PostgreSQL can atomically decide a commit while a lost
  connection leaves the caller uncertain whether its acknowledgement arrived;
  the state and success evidence still commit together, and the resumable
  pending response is conservative.

## U-31 — Canonical hosted tenant migrations

- **Status:** completed
- **Lane:** spec
- **Objective:** make hosted tenant provisioning use the canonical ordered
  migration catalog and checksum-tracking runner instead of app-local SQL
  copies.
- **Source:** repository architecture and immutable migration-history contract.
- **Acceptance criteria:** fresh, replay, and legacy-schema upgrade paths use
  one catalog; applied migrations are checksum tracked; app-local duplicate SQL
  is removed; the production build packages the required catalog safely.
- **Assumptions:** tenant-core migrations remain the only schema required by the
  current hosted provisioning boundary.
- **Files in scope:** migration package/catalog, platform provisioning adapter,
  behavioral tests, package metadata/build configuration if required, and
  durable records.
- **Risks and mitigations:** prove Next.js packaging and old-schema retry rather
  than depending on source-tree-relative runtime files without evidence.
- **Verification:** focused RED/GREEN tests, fresh/replay/upgrade PostgreSQL
  proof, platform build, full repository gates, diff review, Graphify refresh.
- **Evidence paths:** migration runner/catalog/provisioning tests,
  `tooling/migrations/src/tenant-core.integration.test.ts`, and the built admin
  tenant route containing all three canonical SQL bodies.
- **Relevant commits:** canonical hosted-migrations checkpoint (this
  checkpoint).
- **Blockers or gaps:** an already-corrupt tenant database containing multiple
  identity anchors intentionally fails migration `0003` and requires explicit
  owner remediation; no hosted provider deployment was needed for this local
  migration and bundle proof.

## U-32 — Audit-chain behavioral integrity

- **Status:** completed
- **Lane:** fix
- **Objective:** add direct behavioral coverage for the PostgreSQL audit store
  and reject missing or non-contiguous per-scope sequence numbers.
- **Source:** security audit of the append-only hash-chain boundary.
- **Acceptance criteria:** tests cover genesis/next links, per-tenant scope,
  bounded listing, transaction cleanup, tampering, and sequence gaps; chain
  verification fails closed on a missing first or intermediate event.
- **Assumptions:** sequence numbers are monotonic and begin at one within each
  tenant/global scope as documented by the store contract.
- **Files in scope:** database audit store/tests and directly corresponding
  decision-chain verification only if required for semantic consistency.
- **Risks and mitigations:** assert observable SQL/store behavior without
  exposing test-only production APIs or claiming an external transparency log.
- **Verification:** focused RED/GREEN tests, database and Brain package gates,
  full repository validation, and diff review.
- **Evidence paths:** `packages/database/src/audit-store.test.ts`, canonical
  serializer tests, and Brain decision-chain regressions.
- **Relevant commits:** audit-chain integrity checkpoint (this checkpoint).
- **Blockers or gaps:** legacy control-plane hashes cannot retroactively bind a
  tenant ID, and a legacy non-canonical hash whose JSONB key order already
  changed cannot be reconstructed. New hashes are tenant-bound and canonical;
  exact legacy verification remains available where reconstruction is possible.

## U-33 — Complete tenant RLS matrix

- **Status:** completed
- **Lane:** spec
- **Objective:** make CI prove forced fail-closed RLS for every tenant-scoped
  table installed by the tenant-core, Brain, and support migrations.
- **Source:** verification-gap audit of `tooling/ci/rls-proof.mjs`.
- **Acceptance criteria:** a table-driven inventory proves ENABLE and FORCE RLS,
  no-context and wrong-tenant invisibility, correct-tenant visibility, and all
  established append-only restrictions; omitted tenant tables fail the proof.
- **Assumptions:** the migration catalog defines the authoritative tenant-table
  set and synthetic rows may exercise all foreign-key paths.
- **Files in scope:** the RLS proof harness and durable records; migrations only
  if the proof discovers a real policy defect.
- **Risks and mitigations:** use only synthetic IDs/data, dependency-correct
  seeding, a non-BYPASSRLS role, and deterministic cleanup.
- **Verification:** live PostgreSQL proof, repeatability check, CI-equivalent
  gates, diff review, and Graphify refresh.
- **Evidence paths:** `tooling/ci/rls-proof.mjs`; three fresh disposable
  PostgreSQL 17 + pgvector runs each passed all 183 checks and confirmed the
  synthetic `tenant_app` role was absent afterward. PR-head GitHub Actions run
  `29779458840` passed both the main `check` job and the live `rls-proof` job.
- **Relevant commits:** exhaustive RLS matrix checkpoint (this checkpoint).
- **Blockers or gaps:** the package-level test is a syntax check; behavioral
  assurance intentionally remains the dedicated PostgreSQL CI job and the
  disposable local runtime proof.

## U-34 — Reconcile uncertain tenant lifecycle commits

- **Status:** completed
- **Lane:** fix
- **Objective:** distinguish committed tenant creation or activation whose
  acknowledgement was lost from a transaction that did not commit.
- **Source:** U-30 residual-risk audit and PostgreSQL's indeterminate commit
  outcome after a connection failure.
- **Acceptance criteria:** after a COMMIT error, a fresh control-plane read
  verifies the complete expected state and the exact audit sequence/hash
  produced by that transaction; only exact evidence resumes or returns success.
  Missing activation evidence retains the generic pending path, and uncertain
  creation never deletes a provider organisation that may still be mapped.
  Readback outages do not append a definitive activation-failure event.
- **Assumptions:** the activation and success evidence remain atomic and the
  control plane is reachable through a fresh pool query after a client failure.
- **Files in scope:** tenant admin route/tests and durable records.
- **Risks and mitigations:** reconcile read-only using tenant ID plus the exact
  event sequence/hash and expected rows; never infer success from status or a
  historical event alone. Delete a provider organisation only after a
  successful readback proves both that the creation event did not commit and
  that no current mapping remains.
- **Verification:** focused RED/GREEN route tests, platform package gates, full
  repository validation, build, and diff review.
- **Evidence paths:** `apps/platform/app/api/admin/tenants/route.test.ts`.
- **Relevant commits:** `c12d551`, `afcd510`.
- **Blockers or gaps:** if activation readback is unavailable, the response
  remains pending without a contradictory failure event. If creation readback
  is unavailable, setup fails generically while retaining the provider
  organisation; an operator may need to reconcile that rare external object
  after control-plane connectivity returns.

## U-35 — Remove unnecessary edge runtime

- **Status:** completed
- **Lane:** fix
- **Objective:** remove the platform build warning caused by the assessment
  readout route's explicit Edge runtime when its behavior requires no Edge-only
  capability.
- **Source:** verified Next.js production-build warning.
- **Acceptance criteria:** readout behavior remains covered, the route uses the
  supported Node.js runtime, and the production build no longer prints the
  edge-runtime static-generation warning.
- **Assumptions:** provider streaming uses standard Web APIs supported by the
  Next.js Node.js route runtime.
- **Files in scope:** assessment readout route/tests and durable records.
- **Risks and mitigations:** preserve the request, streaming, timeout, and
  provider-normalization contract; verify by exercising the route and build.
- **Verification:** focused RED/GREEN test, platform checks, production build,
  and warning scan.
- **Evidence paths:** route regression tests for validation, both provider
  stream formats, completion framing, 30-second abort behavior, and normalized
  failure responses, plus captured build output.
- **Relevant commits:** `b6f77d7`, `afcd510`.
- **Blockers or gaps:** the Edge warning is gone. A separate Webpack cache
  performance advisory is a build-cache efficiency notice, not a runtime
  correctness failure.

## U-36 — Bound legacy audit verifiability

- **Status:** completed
- **Lane:** spec/security
- **Objective:** preserve immutable legacy evidence while making its weaker
  tenant binding and any unreconstructable digest explicit and machine-readable.
- **Source:** U-32 residual-risk audit.
- **Acceptance criteria:** no historical event is rewritten; verification
  distinguishes canonical, exact legacy, and unverifiable legacy evidence;
  callers cannot mistake a valid canonical suffix for a verified legacy prefix.
- **Assumptions:** cryptographic properties absent from historical hashes cannot
  be created retroactively without replacing the evidence being assessed.
- **Files in scope:** audit contracts/store/tests, additive migration only if
  justified, architecture/durable records.
- **Risks and mitigations:** fail closed, bound verification work, preserve the
  original hashes, and avoid presenting a re-anchor as retroactive proof.
- **Verification:** focused behavioral tests, database/security/Brain package
  checks, migration proof if changed, and independent security review.
- **Evidence paths:** audit-store tests and architecture decision update.
- **Relevant commits:** `8898250`.
- **Blockers or gaps:** historical hashes that omitted tenant scope cannot gain
  that property retroactively, and a legacy digest that no longer matches its
  `jsonb` representation remains `unverified`; the verifier does not relabel or
  rewrite either case.

## U-37 — Diagnose corrupt tenant identity anchors

- **Status:** completed
- **Lane:** owner/security
- **Objective:** turn a multiple-anchor migration failure into a deterministic,
  non-destructive diagnosis and exact remediation requirement.
- **Source:** U-31 residual-risk audit.
- **Acceptance criteria:** migration fails before mutation with a stable error;
  synthetic live coverage proves no row is deleted or selected implicitly and
  no tracking table is created for an untracked legacy database; a runbook
  provides non-mutating isolated-clone evidence and owner-approved repair steps.
- **Assumptions:** selecting or deleting one of several tenant identities is a
  security/data-ownership decision that cannot be inferred locally.
- **Files in scope:** tenant-core migration wrapper/tests, a repair runbook,
  OWNER-TASKS only if an actual ambiguous database is discovered.
- **Risks and mitigations:** never print tenant IDs in generic errors, never
  delete automatically, and require backups plus explicit owner selection for
  any real repair.
- **Verification:** unit and live PostgreSQL RED/GREEN tests, tracking-table,
  mutation-count, and FORCE-RLS proofs, documentation review, and full gates.
- **Evidence paths:** tenant-core integration test and repair runbook.
- **Relevant commits:** `ffef84d`, `afcd510`.
- **Blockers or gaps:** automatic repair is intentionally excluded because it
  would destroy or misassign ambiguous tenant data. If a real database triggers
  the diagnostic, the exact owner steps are recorded in `docs/OWNER-TASKS.md`
  and `docs/runbooks/tenant-anchor-recovery.md`.

## U-38 — Independent residual review and recovery

- **Status:** completed
- **Lane:** fix/security
- **Objective:** independently challenge the four residual closures and repair
  every confirmed integrity, verification, and documentation gap.
- **Source:** independent review of `22ef082..ffef84d` against U-34 through
  U-37 and the original unattended-run goal truths.
- **Acceptance criteria:** uncertain commits bind to exact transaction evidence;
  an untracked multi-anchor database receives no tracking state; owner diagnosis
  works despite FORCE RLS without persistent mutation; Node-runtime streaming
  behavior is directly covered; durable records match current build evidence.
- **Assumptions:** synthetic local PostgreSQL 17 is sufficient runtime evidence
  for migration and RLS behavior; hosted provider mutation is unnecessary.
- **Files in scope:** the tenant route, assessment readout tests, migration
  runner/wrapper/tests, recovery runbook, handoff, shiplog, and this ledger.
- **Risks and mitigations:** exact audit sequence/hash prevents stale-event
  reconciliation; tri-state creation readback prevents destructive compensation
  during an outage; activation ambiguity suppresses definitive failure evidence;
  atomic-catalog preflight retains its PostgreSQL table lock through singleton
  enforcement; clone diagnosis locks both FORCE-RLS tables and rolls back its
  catalog changes.
- **Verification:** Node 22 targeted RED/GREEN tests; 40 migration tests
  including 12 live PostgreSQL cases; forced uncached 51/51 monorepo tasks with
  520 tests; warning-free platform build with 22 static pages; disposable
  PostgreSQL RLS proof with 183/183 checks; `git diff --check`; Graphify refresh
  and integrity/query checks; independent re-review.
- **Evidence paths:** tenant route/readout tests,
  `tooling/migrations/src/tenant-core.integration.test.ts`,
  `docs/runbooks/tenant-anchor-recovery.md`, and generated Graphify artifacts.
- **Relevant commits:** `afcd510`, `07fc2e5`, `e01fc1b`, plus the final CI
  evidence checkpoint.
- **Blockers or gaps:** no confirmed code defect remains. Genuine multi-anchor
  recovery intentionally remains owner-led because choosing an identity is a
  data-ownership decision; a creation readback outage can leave an external
  provider organisation requiring later operator reconciliation.

## U-39 — Split shadcn builder and marketing surfaces

- **Status:** completed
- **Lane:** spec/legal boundary
- **Objective:** give tenant-module builders a redistribution-safe shadcn UI
  baseline while keeping licensed Shadcn Studio assets in a separate marketing
  end product.
- **Source:** owner request on 2026-07-21 and the accepted Developer MCP/module
  ownership architecture.
- **Acceptance criteria:** a buildable Apache-licensed tenant starter uses only
  the official shadcn registry and semantic brand tokens; Studio aliases,
  credentials and source are absent from the OpenTenant release; a separate
  marketing repository configures all supplied Studio namespaces, delivers a
  responsive baseline, and records exact provenance and licence limits.
- **Assumptions:** Shadcn Studio's current end-product grant covers the private
  marketing site, while its end-user-builder and redistribution restrictions
  exclude the tenant Developer MCP and reusable template.
- **Files in scope:** tenant starter, shadcn/product/architecture/legal docs,
  workspace lockfile, durable records, and the separate local marketing repo.
- **Risks and mitigations:** no credential values were read or copied; premium
  content remains unused until `EMAIL` and `LICENSE_KEY` exist in the marketing
  repo only; generated shadcn source carries exact MIT notice and registry
  digest; UI code grants no data capability; registry additions remain subject
  to dependency, licence, sandbox and publication review.
- **Verification:** shadcn CLI `info`, `view`, and `--dry-run`; focused render
  test; tenant starter standalone build; marketing lint/build; Chromium
  full-page inspection at 1440px and 390px; forced uncached 54/54 repository
  lint/typecheck/test tasks with 523 tests; warning-free platform and starter
  builds; link check, diff review, production dependency audit, licence
  inventory, and Graphify refresh to 3,154 nodes and 5,799 edges.
- **Evidence paths:** `templates/tenant-module-nextjs`,
  `docs/product/module-ui.md`, the separate marketing repository's
  `LICENSE-PROVENANCE.md`, and ignored local browser screenshots.
- **Relevant commits:** OpenTenant UI checkpoint (this checkpoint); separate
  marketing repository checkpoint `bd599cb`.
- **Blockers or gaps:** the successful Developer MCP scaffold route still needs
  owner-approved server template identifiers/tool schemas. Premium Studio
  resources need the two documented credentials in the marketing repository;
  OpenTenant's current `.env` does not contain those variable names.

## U-40 — Safe unattended development controller

- **Status:** completed
- **Lane:** tooling/spec
- **Objective:** research proven unattended agent pipelines and add a durable,
  bounded controller that can continue approved local OpenTenant work without
  converting owner gates or external mutations into agent authority.
- **Source:** owner request on 2026-07-21 and the accepted multi-tenant
  operations delivery sequence.
- **Acceptance criteria:** machine-readable tasks are dependency-aware and
  owner-gated work is never selected; execution requires a clean isolated
  Node 22 worktree without `.env`; every agent task is path/time bounded and
  independently requires a `not_verified` transition, controller-owned task
  checkpoint, clean output, sandboxed empty-home verification, and a separate
  controller completion commit; no push, merge, deploy, provider call,
  publication, destructive Git, genuine data, or secret access is authorized.
- **Assumptions:** Codex is the first execution engine, local worktrees are the
  first isolation boundary, and GitHub-hosted write automation remains unsafe
  until protected branches/rulesets and a reviewed safe-output job exist.
- **Files in scope:** `tooling/unattended`, root scripts/ignore/lockfile,
  machine backlog, implementation/research/provenance docs, durable records,
  and Graphify output.
- **Risks and mitigations:** only allowlisted argv-array verification runs
  without a shell inside an OS-enforced no-network profile and an empty
  temporary home; agent tools can write only declared task paths, while ignored
  dependencies/caches/run state are read-only and snapshotted; they cannot read
  home/sibling files or write Git metadata; root environment files, non-`codex/`
  branches, dirt, stale graph state, ignored or out-of-scope changes, unbounded
  time, mutated recovery contracts, missing checkpoints, and failed checks stop
  the run; failures retain evidence and never trigger automatic reset.
- **Verification:** 32 focused Node tests and strict JS type checking; Linux CI
  child-runtime regression coverage; CLI status/prompt/dirty-preflight smoke;
  first real `OPS-01` execution through
  agent checkpoint, recovery, full controller verification, and completion
  commit; forced Node 22 monorepo check with 57/57 tasks; forced 22-page
  platform build; the same complete profile in a source-read-only,
  no-tool-network, empty-home sandbox; `git diff --check`; Graphify
  update/check/query and independent diff review.
- **Evidence paths:** `docs/tooling/unattended-development.md`,
  `docs/plans/unattended-backlog.json`, `tooling/unattended/src/*.test.mjs`,
  `graphify-out/GRAPH_REPORT.md`, and this ledger entry.
- **Relevant commits:** `6330f88`, `b039957`, `612c759`, `584366b`, `e48a0f1`,
  `b384b3a`, `74e48d3`, and review hardening `1061bd4` on
  `codex/unattended-pipeline-ready`.
- **Blockers or gaps:** none for local bounded execution. Hosted scheduling and
  writeback stay owner-gated; GitHub Agentic Workflows is Public Preview and is
  not installed.
- **Review closure:** independent review found and verified fixes for an
  agent-controlled `tsBuildInfoFile` path escape, a committed-range whitespace
  check gap, and a stale-lock replacement race. Custom compiler cache paths now
  fail closed, `git diff --check` receives the exact checkpoint range, and an
  atomic recovery claim serializes stale-lock replacement.
- **CI closure:** GitHub's Linux runner exposed fixed macOS Node/Git lookup in
  sanitized child processes. The active Node runtime and resolved Git
  executable are now retained without widening the environment or filesystem
  policy.

## U-41 — Installation-owner permission seam (`OPS-01`)

- **Status:** completed
- **Lane:** spec
- **Objective:** introduce installation-owner authority and permissions without
  changing established tenant behavior.
- **Source:** `docs/architecture/multi-tenant-operations.md#18-delivery-sequence`
  and `docs/plans/unattended-backlog.json`.
- **Acceptance criteria:** installation authority remains distinct from tenant
  membership and support context; existing tenant creation remains covered
  through its public route; unknown or ambiguous authority fails closed; and
  privileged actions retain installation-owner audit attribution.
- **Assumptions:** the existing exact platform-administrator flag is the narrow
  compatibility input for the initial installation-owner seam. Managed-support
  policy and sensitive-action separation remain the next independent slice.
- **Files in scope:** `packages/auth`, `packages/security`, the platform
  installation guard and tenant-creation route/tests, durable records,
  `CHANGELOG.md`, and Graphify output.
- **Risks and mitigations:** authority is normalized into a closed permission
  vocabulary; tenant/module permissions and unknown runtime values deny; the
  route checks authority before provider or database work; success and denial
  evidence preserve the real installation-owner actor.
- **Verification:** focused RED/GREEN evidence; 34 focused auth/platform tests;
  controller-owned checkpoint; sandboxed 107-test platform suite; all 57 forced
  monorepo lint/typecheck/test tasks; 22-page production build; `git diff
  --check`; and `graphify check-update .`.
- **Evidence paths:** `packages/auth/src/installation-authority.test.ts`,
  `apps/platform/lib/installation-owner.test.ts`,
  `apps/platform/app/api/admin/tenants/route.test.ts`, `docs/SHIPLOG.md`, and
  `docs/plans/unattended-backlog.json`.
- **Relevant commits:** implementation checkpoint `3598ca4`; independent
  completion commit `9ac1a0e`; review hardening `1061bd4` on
  `codex/unattended-pipeline-ready`.
- **Blockers or gaps:** none for `OPS-01`. The next ready local task is
  `OPS-02`, managed-support context.

## U-42 — Module ownership boundaries (`OPS-04`)

- **Status:** completed
- **Lane:** spec
- **Objective:** add platform, installation-owner, and tenant-private module
  ownership with immutable promotion boundaries.
- **Source:** `docs/architecture/multi-tenant-operations.md#8-module-ownership-and-sharing`
  and `docs/plans/unattended-backlog.json`.
- **Acceptance criteria:** tenant-created modules default to tenant-private and
  cannot be entitled outside their tenant; installation-owner modules remain
  bounded to their installation; promotion requires a reviewed immutable copy
  with new identity, version, artifact digest, and provenance, and never mutates
  the source artifact.
- **Assumptions:** the repository currently models one installation, so the
  installation boundary is represented explicitly and defaults to the local
  installation identifier only at the composition boundary; published module
  versions and ownership records are immutable.
- **Files in scope:** `packages/platform-core`, `packages/database`,
  `packages/module-sdk`, platform module composition, control-plane migrations,
  durable records, `CHANGELOG.md`, and Graphify output.
- **Risks and mitigations:** closed ownership vocabularies, database constraints,
  public domain tests, tenant/installation entitlement denial tests, copy-only
  promotion, digest validation, exact trusted remote-host allowlisting,
  same-origin decoded-path enforcement, outbound header allowlisting, and live
  PostgreSQL proof prevent scope widening, source mutation, SSRF, and credential
  forwarding.
- **Verification:** focused RED/GREEN tests; live PostgreSQL migration and
  constraint proof; platform tests; forced monorepo typecheck/lint/test; platform
  build; `git diff --check`; Graphify refresh/check; independent diff review.
- **Evidence paths:** `packages/platform-core/src/module-ownership.test.ts`,
  `packages/database/src/module-ownership-store.integration.test.ts`,
  `tooling/migrations/src/control-plane-module-ownership.integration.test.ts`,
  control-plane migration `0014`, and the canonical module audit chains.
- **Relevant commits:** implementation checkpoint `6fc3209`; the completion
  record is the following controller-owned ledger commit.
- **Blockers or gaps:** none for `OPS-04`. Public publication, provider
  deployment, marketplace controls, and Developer MCP publication remain
  explicitly excluded. `OPS-05` is complete; the next ready local task is
  `OPS-06`, helpdesk core and owner projection.

## U-43 — Brokered module capabilities (`OPS-05`)

- **Status:** completed
- **Lane:** spec
- **Objective:** add denial-first, version-bound module capability declarations
  and tenant grants, then exercise one narrow tenant-data operation without
  exposing database or provider credentials.
- **Source:** `docs/architecture/multi-tenant-operations.md#9-module-data-access`
  and `docs/plans/unattended-backlog.json`.
- **Acceptance criteria:** manifest requests, creator delegable authority,
  tenant grant, runtime-user permission, active module version, and exact tenant
  binding all cap access; remote callers receive only a bounded broker response;
  unknown capability/scope/binding/permission fails closed with content-free,
  hash-chained audit evidence.
- **Assumptions:** the first vocabulary contains only the documented
  `support.ticket.read` capability; its initial broker operation is an
  identity-backed, read-only, bounded ticket-summary list. Capability
  declaration and grant persistence are server composition boundaries in this
  slice; no grant UI or provider role mutation is implied.
- **Files in scope:** `packages/module-sdk`, `packages/auth`,
  `packages/database`, `packages/security`, platform broker composition and
  route, the support module's dedicated content-minimized read boundary,
  control-plane migrations, durable records, `CHANGELOG.md`, and Graphify
  output.
- **Risks and mitigations:** a closed capability vocabulary, immutable
  version-bound declaration, creator ceiling, revocable/expiring tenant grant,
  fresh runtime-permission and entitlement checks, exact ownership predicates,
  bounded output projection, control-plane locking during the tenant read, and
  denial audit evidence prevent confused-deputy access, stale grants,
  cross-tenant reads, credential disclosure, and content leakage into logs.
- **Verification:** public module-SDK RED/GREEN tests; database unit tests; a
  route-level signed-context and broker projection suite; disposable PostgreSQL
  migration, grant, revocation, tenant-denial, and canonical-audit proof; forced
  monorepo typecheck/lint/test; platform build; `git diff --check`; Graphify
  refresh/check; independent security review.
- **Evidence paths:** `packages/module-sdk/src/capabilities.test.ts`,
  `packages/security/src/module-context.test.ts`,
  `packages/database/src/module-capability-store.integration.test.ts`,
  `tooling/migrations/src/control-plane-module-capabilities.integration.test.ts`,
  `apps/platform/app/api/module-broker/[module]/support/tickets/route.test.ts`,
  `apps/platform/lib/module-capability-broker.test.ts`, and
  `tooling/ci/rls-proof.mjs`. Evidence: 13 SDK, 34 security, 63 database, 6
  support, 155 platform, and 28 migration unit tests; three live migration and
  two live store cases; 183/183 fresh-cluster RLS checks; 57/57 forced Turbo
  tasks; 27-page production build; clean dependency audits, frozen starter
  lockfile, diff check, independent review, and a clean Graphify refresh/check
  at 3,563 nodes, 6,752 edges, and 228 communities.
- **Relevant commits:** pull request #19 merged as `99d869a`; local
  implementation checkpoint `5a5429a`; hosted CI run `29914040237` passed.
- **Blockers or gaps:** none for `OPS-05`. Broad SQL/database access,
  service grants, grant-management UI, provider permission changes, Developer
  MCP publication, and external deployment are explicitly excluded.
- **Invalidated assumption:** projecting complete support records in the
  platform would read customer content before minimization. The active task
  scope now explicitly includes `modules/support/` so the fixed 25-row summary
  query can live at the data-owning module boundary; no other task contract or
  product behavior changed.
- **Goal-truth audit:** verified that the broker exposes only the fixed
  content-minimized operation; creator, tenant, version, runtime permission,
  identity, entitlement, and ownership are freshly intersected; remote callers
  receive no database/provider credential; errors and audit evidence contain no
  ticket content; ambiguity fails closed; no provider SDK escaped its existing
  composition boundary; and no real tenant, account, domain, or provider
  identifier is hard-coded. Local gitleaks was unavailable, so the pinned
  hosted gitleaks job remains the final secret-scan evidence.
