# Fix-wave-4 Developer MCP and Brain verification

Branch: `t3/implement-developer-mcp-brain-tools`.
Base: `e5c082910`. All operations were local. No push, PR, deployment,
model-provider call or deployed configuration enablement occurred.
Marketing impact: truth.

## Delivery and limits

- Developer MCP: locally callable request handler and disabled application route.
  Default-off configuration and exact production route approval enforce
  OWNER-DEVELOPER-MCP-02. One synthetic service-template tool uses the local
  sandbox contract and returns a static, one-time preview after teardown.
- Brain: made real because existing forced-RLS storage, pgvector and the decision
  chain support the tools with bounded additions. Search resolves model-routing
  policy before local embedding. Promotion and its decision commit together.
  The HTTP route checks signed context, matching live session and entitlement.
- Documentation: runbook, capability statuses, handoff and reservation updated.
  Status is implemented locally, disabled pending owner approval, not live.

The full accepted pre-exposure contract is **not closed**. The
[runbook](../runbooks/developer-mcp.md#integration-ownership-handoff) names shared
migration 0070 registration, global startup validation, package wiring, CI suite
registration, OAuth and browser confirmation composition, the well-known alias,
and real VM credential/network proofs. Those paths/proofs are outside this
implementation's assigned ownership. The package exports the DDL and config
helpers for integration; requests never install schema. Local opaque-token
verification is not an OAuth authorization server. No hosted adapter is enabled.

## Final commands

Counts are pass / fail / skip. Checks and build invocations are distinguished
from test cases. Skips are not credited as proof.

| Command | Exit | Counts and result |
| --- | --- | --- |
| `pnpm turbo typecheck lint test --concurrency=2` | 0 | 81 / 0 / 0 tasks; 2,015 / 0 / 69 test cases, including cached results. Vitest 1,862 passes; Node test runner 153 passes. The plain invocation skips database/optional integration cases. |
| `pnpm --filter @opentenant/platform build` | 0 | 1 / 0 / 0 builds. Next compiled, checked types and generated 28 pages. Existing rate-limiter dynamic-import and ESLint-plugin warnings remain. |
| `pnpm db:ephemeral -- pnpm rls:proof` | 0 | 314 / 0 / 0 checks across 31 tenant tables. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/developer-mcp --filter @opentenant/brain test` | 0 | 148 / 0 / 0 tests. Developer MCP 135, Brain 13. The six Brain PostgreSQL cases live in the Developer MCP suite so Brain's package manifest remains unchanged. |
| `git diff --check` | 0 | 1 / 0 / 0 checks. |
| `pnpm audit --prod --audit-level high` | 0 | Zero high/critical production advisories; five moderate and one low remain. |
| `gitleaks dir . --config /tmp/mcp-gitleaks-source.toml --no-banner --redact --report-format json --report-path /tmp/mcp-gitleaks-final2.json` | 0 | Zero source findings. Temporary configuration extends repository rules and excludes generated `.next`, `dist`, `node_modules` and graph output. A raw build-output scan reported 86 generated findings; a synthetic idempotency-key false positive was replaced by a generated test identifier. |
| `SEMGREP_SEND_METRICS=off semgrep scan --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --no-git-ignore apps/platform/app/api/mcp modules/brain/src packages/developer-mcp/src packages/sandbox/src` | 0 | Two local rules, 82 files, zero findings. A broader no-git-ignore attempt failed in semgrep-core; this successful scan includes the assigned untracked source. |
| `trivy fs --offline-scan --skip-db-update --skip-java-db-update --skip-check-update --skip-version-check --skip-dirs node_modules --skip-dirs apps/platform/.next --skip-dirs graphify-out --scanners vuln,misconfig,secret --exit-code 1 --severity HIGH,CRITICAL .` | 1 | Two critical existing development advisories in `tinypool@1.1.1`: CVE-2026-104848 and CVE-2026-104849. No new production advisory. Root test-runner upgrades are outside this ownership. |
| `graphify update .` | 0 | AST graph refreshed; generated files are excluded from the commit. SQL parser dependency and zero-symbol-file warnings remain. No semantic/model extraction was run. |

No `.pre-commit-config.yaml` or Promptfoo configuration exists. Neither check is
claimed as a pass. No real microsandbox VM or browser review journey was run.
The local sandbox end-to-end proof uses the real sandbox adapter contract with
an injected local stub. The shared sandbox suite's optional VM skip remains a
skip in the full test tally.

Ripwire change context and quality delta were also inspected. Brain's existing
route no longer exceeds the complexity threshold. One scalar-input-validator
shape is still reported as a duplication heuristic; new handler/service
complexity warnings remain. Ripwire is not recorded as a clean quality verdict.

## Tests added or replaced

- `packages/developer-mcp/src/runtime.integration.test.ts`: twelve composed
  PostgreSQL cases covering unauthenticated and revoked-membership denial,
  foreign tenant, token expiry, installation and tenant switches, confirmation,
  audit rows and chain integrity, rate and concurrency admission, forged input,
  wrong audience, expired/cross-client confirmation, transactional audit failure,
  and successful local sandbox execution with teardown and a bound single-use
  preview. Tokens and process-output canaries do not enter sandbox requests or
  returned tool results.
- `packages/developer-mcp/src/brain.integration.test.ts`: six real PostgreSQL
  cases for pgvector search and model policy, unavailable hosted adapters,
  forced-RLS foreign/missing context, all four tools, citation-bearing decisions,
  and promotion rollback on decision-audit failure.
- `packages/developer-mcp/src/config.test.ts`: three configuration, metadata and
  modern transport cases.
- `apps/platform/app/api/mcp/developer-mcp-surface.test.ts`: replaces the absence
  assertion with two executable default-off/exact-production-approval cases.
- `modules/brain/src/embeddings.test.ts`: deterministic, normalized local vectors.
- `apps/platform/app/api/mcp/brain/route.test.ts`: executes read results instead
  of expecting 501 and adds revoked-entitlement denial.

## Failed runs and retries

The host was loaded. Timeout runs were rerun and are not treated as proof.

| Run | Counts | Outcome |
| --- | --- | --- |
| First Developer MCP database run | 121 / 1 / 6 tests; two failed suites | Brain fixture used the removed organization column; teardown hit the default ten-second hook timeout. One valid authorization could also deny when its revocation timestamp advanced past the captured call time. |
| Immediate rerun | 122 / 0 / 6 tests; one failed suite | Freshness fixed; fixture then hit tenant metadata's singleton constraint. The earlier hook timeout did not recur. |
| Third run | 119 / 3 / 6 tests; one failed suite | Missing restricted role fixture; rate test hit the default five-second timeout and its unfinished work affected the next two fixtures. |
| Immediate timeout rerun | 127 / 4 / 0 tests | Thirty-second test allowance removed the timeout. Restricted-role execution exposed the raw-signal FOR SHARE privilege issue; real model routing also required its consent-policy fixture. |
| Corrected run | 131 / 0 / 0 tests | Both PostgreSQL suites passed. |
| Expanded run | 147 / 0 / 0 tests | Concurrency, confirmation expiry/client binding and audit rollback added. |
| Membership recheck run | 148 / 0 / 0 assertions, two unhandled errors | Process failed because forced DROP DATABASE interrupted closing pg sockets. The disposable server was destroyed. Vitest emitted disposable connection fields; the retained log is redacted. |
| Corrected teardown run and final rerun | 148 / 0 / 0 tests each | Exit zero, no unhandled errors. Controller owns database destruction; runtime awaits its in-flight watchdog check. |

The first full quality run passed 81 tasks. A later run failed typechecking after
pinning mismatched pg type versions and using an unsupported Vitest suite option.
The pin now matches the workspace's `@types/pg@8.20.4`, the unsupported option was
removed, and the subsequent and final full quality runs both passed all 81 tasks.
All three platform build invocations passed.
