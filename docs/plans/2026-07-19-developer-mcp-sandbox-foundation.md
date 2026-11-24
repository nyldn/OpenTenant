# Developer MCP sandbox foundation implementation plan

> Execute this plan test-first on `feat/developer-mcp-foundation`. Keep the
> sandbox provider boundary independent from Developer MCP authentication,
> tenant data, credentials, publication, and production provisioning.

**Goal:** Deliver the container-first foundation for OpenTenant module
development: a provider-neutral sandbox contract, deterministic policy and
error behavior, a conformance harness, and narrow sandboxd/Vercel adapter
boundaries that can be evaluated without exposing secrets or buying capacity.

**Architecture:** A new `@opentenant/sandbox` workspace package owns the
execution contract. OpenTenant remains the control plane; adapters receive
opaque workspace requests and return normalized state, logs, preview handles,
and typed failures. The first implementation uses a deterministic in-memory
adapter for orchestration tests. Real-provider adapters translate only their
documented APIs and advertise capabilities; unsupported security-critical
operations fail closed.

**Technology:** TypeScript 5.7, Vitest 3, Node 22 fetch API, pnpm 11.13.1,
Turborepo. No provider SDK or production resource is required in this slice.

**Status:** Tasks 1–7 are complete. The OpenTenant repository and CI are
verified.

**Governing artifacts:**

- `docs/product/developer-mcp.md`
- `docs/architecture/adr-005-developer-mcp-sandbox-adapter.md`
- `.claude/CLAUDE.md` SOC 2, secrets, Vercel, and delivery rules

## Scope guardrails

- Synthetic data only.
- No raw environment variables or secret values in the contract.
- No shell command strings; commands are executable plus argument arrays.
- No Docker daemon, sandboxd service, Vercel sandbox, paid plan, or external
  deployment is created by the automated test suite.
- No OpenFlow code is copied.
- The repository-wide OpenTenant rename is a separate mechanical work package;
  this package intentionally starts on the new namespace.

## Task 1: Scaffold the sandbox package and lifecycle contract

**Files:**

- Create `packages/sandbox/package.json`
- Create `packages/sandbox/tsconfig.json`
- Create `packages/sandbox/src/contracts.ts`
- Create `packages/sandbox/src/errors.ts`
- Create `packages/sandbox/src/index.ts`
- Test `packages/sandbox/src/contracts.test.ts`

**Red:** Add compile-time and runtime tests covering stable lifecycle states,
capability declarations, retryable versus terminal error classification, and
the absence of any environment/credential field from command requests.

**Green:** Implement:

- opaque sandbox/checkpoint identifiers;
- create, file-write, structured-command, preview, checkpoint, restore, logs,
  artifact, and termination requests/results;
- adapter capability declarations;
- `SandboxError` with stable code, operation, retryability, and non-secret
  details;
- the `SandboxAdapter` interface.

**Verify:**

```bash
pnpm --filter @opentenant/sandbox test
pnpm --filter @opentenant/sandbox typecheck
```

Commit: `feat(sandbox): define provider-neutral lifecycle contract`

## Task 2: Enforce request and workspace policy at the boundary

**Files:**

- Create `packages/sandbox/src/policy.ts`
- Test `packages/sandbox/src/policy.test.ts`
- Update `packages/sandbox/src/index.ts`

**Red:** Add table-driven tests rejecting absolute paths, traversal, NULs,
empty paths, duplicate writes, unbounded time/output requests, invalid ports,
empty executables, URL-like executable values, and allowlisted hosts containing
paths or credentials. Include accepted boundary values.

**Green:** Add pure validators and normalizers. Defaults remain below hard
maximums; adapter code must consume validated values. Error messages identify
the invalid field but never echo file contents, arguments, headers, tokens, or
provider response bodies.

**Verify:** Run the package tests and typecheck.

Commit: `feat(sandbox): add fail-closed workspace policy`

## Task 3: Build the deterministic adapter and shared conformance suite

**Files:**

- Create `packages/sandbox/src/testing/in-memory-adapter.ts`
- Create `packages/sandbox/src/testing/conformance.ts`
- Create `packages/sandbox/src/testing/in-memory-adapter.test.ts`
- Update `packages/sandbox/src/index.ts`

**Red:** Define conformance tests for create, isolated file state, command
result limits, preview expiry, checkpoint/fork restore, log truncation,
idempotent termination, not-found behavior, tenant/workspace attribution, and
state rejection after termination.

**Green:** Implement an in-memory adapter with injected clock, ID generator,
and command executor. It is a deterministic test double, explicitly not a
security boundary. Make it pass the shared suite.

**Verify:** Run package tests/typecheck and the repository lint gate for the
new package.

Commit: `test(sandbox): add lifecycle conformance harness`

## Task 4: Add the sandboxd HTTP adapter and record its capability gap

**Files:**

- Create `packages/sandbox/src/providers/sandboxd/types.ts`
- Create `packages/sandbox/src/providers/sandboxd/client.ts`
- Create `packages/sandbox/src/providers/sandboxd/adapter.ts`
- Test `packages/sandbox/src/providers/sandboxd/adapter.test.ts`
- Create `docs/architecture/evidence/developer-sandbox-sandboxd.md`
- Update `packages/sandbox/src/index.ts`

**Red:** Mock `fetch` and test bearer authentication, URL/path encoding,
private sandbox creation, app-relative file translation, preview
normalization, stop-before-snapshot, fork-from-snapshot restore, bounded log
retrieval, deterministic deletion, status-to-error mapping, response shape
validation, and redaction of upstream bodies.

**Green:** Implement the narrow documented REST mapping. The adapter must
advertise `structuredCommands: false` and throw `unsupported` for
`runCommand`: sandboxd currently exposes agent tasks and an interactive
WebSocket terminal, not a bounded structured-exec HTTP endpoint. Do not emulate
commands through an LLM prompt or shell text. Record that this prevents
sandboxd from passing the full production conformance gate without an upstream
extension or tightly reviewed terminal bridge.

**Verify:** Package tests/typecheck; confirm no token appears in snapshots or
errors.

Commit: `feat(sandbox): evaluate sandboxd lifecycle adapter`

## Task 5: Add the hosted Vercel adapter seam without provisioning

**Files:**

- Create `packages/sandbox/src/providers/vercel/client.ts`
- Create `packages/sandbox/src/providers/vercel/adapter.ts`
- Test `packages/sandbox/src/providers/vercel/adapter.test.ts`
- Create `docs/architecture/evidence/developer-sandbox-vercel.md`
- Update `packages/sandbox/src/index.ts`

**Red:** Using an injected provider client, test creation policy translation,
structured command and timeout mapping, preview normalization, log limits,
checkpoint capability reporting, termination, typed provider errors, and
secret-free diagnostic output.

**Green:** Implement the adapter against a small internal client interface so
the Vercel SDK and credentials remain outside the product contract. Tests use a
fake client. Record the exact live questions still requiring an approved
staging probe: plan availability, region, cold start, retention, preview auth,
network policy, checkpoint semantics, cost, and deletion evidence.

**Verify:** No Vercel CLI; no live API mutation; package and repository gates.

Commit: `feat(sandbox): add Vercel hosted adapter boundary`

## Task 6: Add a synthetic module-template orchestration proof

**Files:**

- Create `packages/sandbox/src/template.ts`
- Test `packages/sandbox/src/template.test.ts`
- Create `packages/sandbox/src/orchestrator.ts`
- Test `packages/sandbox/src/orchestrator.test.ts`
- Add minimal fixtures under `packages/sandbox/src/testing/fixtures/`
- Update `packages/sandbox/src/index.ts`

**Red:** Test the complete provider-independent sequence: create workspace,
write an approved immutable template, run install/build/test commands through
the adapter, expose a synthetic preview, collect validation evidence, and
terminate. Verify cleanup on every intermediate failure and verify that an
adapter missing required capabilities is rejected before workspace creation.

**Green:** Implement the orchestration service and immutable template digest.
Use the in-memory adapter's injected executor; do not execute fixture code on
the host. Produce a normalized evidence record ready for later audit-store
integration.

**Verify:** Package test/typecheck/lint followed by the monorepo gate.

Commit: `feat(sandbox): prove synthetic module preview lifecycle`

## Task 7: Delivery evidence and handoff

**Files:**

- Update `docs/HANDOFF.md`
- Update `docs/SHIPLOG.md`
- Update `docs/OWNER-TASKS.md` only if a new sponsor-only blocker is proven
- Update the two provider evidence files with final test results

**Checks:**

```bash
pnpm --filter @opentenant/sandbox lint
pnpm --filter @opentenant/sandbox typecheck
pnpm --filter @opentenant/sandbox test
pnpm turbo typecheck lint test
pnpm turbo build --filter=@opentenant/platform
git diff --check
```

Review the branch diff against the PRD and ADR, run an independent review when
the environment permits, address confirmed findings, push the feature branch,
open an evidence-backed PR, wait for CI, and self-merge only when all required
checks are green.

## Deferred work packages

1. Complete the repository-wide OpenTenant identity migration, including
   package scopes, product copy, environment names, docs, test fixtures,
   deployment metadata, and the remote repository name.
2. WorkOS-authenticated `/api/mcp/developer` tools over the sandbox
   orchestration service.
3. Tenant-private module registry, immutable publication evidence, deployment,
   disable, and rollback.
4. Brokered data, credential, and infrastructure capabilities.
5. Resume WP-D.2 ingestion after its owner-controlled OAuth dependencies are
   ready.
