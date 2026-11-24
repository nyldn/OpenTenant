# Domain and theme browser integration verification

Date: 2026-11-11. Branch: `t3/wire-domain-theme-e2e`.
Base: `c4b0bc14ce1513d0de96c6d4c19d156081101454`.
Node `v22.23.2`, pnpm `11.13.1`, Chromium through Playwright `1.61.1`.
Local synthetic data only. No push, PR, production service or provider operation.
Marketing impact: none.

## Result

The final `pnpm e2e` passed **11 of 11** cases in 2.4 minutes, using one worker,
zero retries, zero skipped cases and zero fixmes. Every run used a uniquely named
`pgvector/pgvector:0.8.2-pg17-bookworm` container on a random loopback port other
than 5432. Containers, databases, DNS controls and temporary TLS material were
removed by teardown. Browser assertions use the real domain handler, store and
audit transaction with only TXT lookup injected.

| Spec | Cases | Result |
| --- | ---: | --- |
| `tooling/e2e/specs/custom-domains.e2e.spec.ts` | 1 | Pass: add, absent TXT, verified TXT, persisted hash/audit, resolve, sign-in redirect, remove |
| `tooling/e2e/specs/theming.e2e.spec.ts` | 2 | Pass: alpha/beta tokens on home/settings/support; hostile persisted CSS/HTML |
| `tooling/e2e/specs/proxy.spec.ts` | 2 | Pass: sandbox CSP/cookie stripping; private no-store cache policy |
| `tooling/e2e/specs/settings.spec.ts` | 2 | Pass: branding; owner membership |
| `tooling/e2e/specs/support.spec.ts` | 1 | Pass: support list/create |
| `tooling/e2e/specs/tenant.spec.ts` | 3 | Pass: unknown host with session; sign-in/out; home/launcher |

The redirect check uncovered Next retaining the original URL after middleware
rewriting. The small application fix uses that original path when the rewrite's
`path` query is absent. Three unit cases cover sign-in return paths, settings,
and dropping callback code/state. The mutation route logic remains unchanged.

## Commands and results

Commands ran from the repository root. Output logs below are host-local files in
`/tmp/opentenant-domain-theme-*`; Playwright's final HTML report is in the
ignored `tooling/e2e/playwright-report` directory.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @opentenant/e2e add --save-dev --save-exact next@15.5.29 --offline` | Pass; reuse installed Next version for test composition typings; lockfile updated |
| `pnpm --filter @opentenant/e2e typecheck && pnpm --filter @opentenant/e2e lint && pnpm --filter @opentenant/e2e test` | Final pass, including all 3 Node safety tests |
| `pnpm --filter @opentenant/platform exec vitest run lib/server-config.test.ts next.config.test.ts` | 28 passed |
| `pnpm --filter @opentenant/platform exec vitest run lib/custom-domains-auth.test.ts lib/server-config.test.ts next.config.test.ts` | 36 passed |
| `pnpm --filter @opentenant/platform exec tsc --noEmit` | Pass after correcting the webpack callback type |
| `pnpm turbo typecheck lint test --concurrency=4` | Final pass: 69/69 tasks, 26 cached, 2m12.332s |
| `pnpm --filter @opentenant/platform build` | Pass, exit 0; standalone server and build ID produced; Next emitted its existing ESLint-plugin detection warning |
| `pnpm e2e` | Final pass: 11/11, 2.4m; see all earlier attempts below |
| `pnpm audit --prod --audit-level high` | Exit 0; zero high/critical; existing 1 low and 6 moderate advisories |
| `git diff --check` | Pass |
| `graphify query 'Playwright e2e harness custom domains domainMutation server composition' --budget 1800` | Pass; located the domain injection and configuration roots |
| `graphify update .` | Pass, AST-only; generated graph/report left uncommitted |
| `ripwire . --exemplar='test server dependency injection' --max-tokens=1600` | Pass; exemplar output read |
| `ripwire . --edit-check=serverConfig` | Unchanged contract, no incompatible callers |
| `ripwire . --quality-delta` | Final exit 0, gating=0 after extracting tenant seeding helpers; callback resolver is a static-analysis dead-code false positive, exercised by the browser verification |

The first harness typecheck identified missing DOM/Next types and incorrect use
of fetch's `ok` property. The first DNS-control safety test incorrectly used
Undici to forge Host, which Undici rewrote. It now uses Node HTTP for that case.
The first full quality run stopped after 27 successful tasks because restarting
Next dev removed generated `.next/types` files during typechecking. The final
run above passed. An earlier production build was stopped with exit 130 while
the browser server still owned `.next`; the final build ran after browser and
quality completion.

The default quality command still skips existing environment-gated integration
coverage. These are **not counted as passing proofs**: migrations report 22
skipped tests and 13 skipped files; database reports 12 skipped tests and 9
skipped files; platform reports 6 skipped custom-domain integration tests and
2 skipped files, including provisioning; notifications reports 1 skipped Mailpit
test. Total: 41 reported skipped tests and 24 skipped files. Some gated files
register zero tests without their database environment. The browser suite's
real Postgres migrations and transactions ran without skips.

## Browser attempt history

No retry configuration or timeout was increased. Failed runs were retained in
separate host-local log files and corrected before the final full run.

| Command | Log suffix | Result |
| --- | --- | --- |
| `pnpm e2e` | `e2e-run1.log` | Custom-domain case timed out at 60s after a webpack replacement resolution error; run interrupted, not a passing suite |
| `pnpm e2e` | `e2e-run2.log` | Required rerun: 10 passed, custom-domain case timed out at 60s after real same-origin rejection; 3.7m |
| `pnpm e2e` | `e2e-run3.log` | 10 passed; custom-domain case failed the sign-in return-path assertion, without timing out; 1.3m |
| `pnpm e2e --grep '^owner adds'` | `e2e-domain-debug.log` | No tests selected, exit 1; Playwright grep includes the full test title and file |
| `pnpm e2e --grep 'owner adds'` | `e2e-domain-debug2.log` | 1 failed at the return-path assertion; temporary URL diagnostic confirmed Next's original URL and was removed |
| `pnpm e2e` | `e2e-final.log` | 11 passed, zero skips/fixmes, 2.4m |

## Security checks

Exact final commands:

```sh
gitleaks dir . --config /tmp/opentenant-domain-theme-gitleaks.toml --redact --no-banner --report-format json --report-path /tmp/opentenant-domain-theme-gitleaks-final.json
semgrep scan --config /tmp/opentenant-domain-theme-semgrep.yaml --metrics off --disable-version-check --error --json --output /tmp/opentenant-domain-theme-semgrep-final.json .
trivy fs --exit-code 1 --skip-version-check --skip-db-update --skip-java-db-update --offline-scan --scanners vuln,misconfig --severity HIGH,CRITICAL --skip-dirs node_modules --skip-dirs .git --skip-dirs apps/platform/.next --skip-dirs graphify-out --format json --output /tmp/opentenant-domain-theme-trivy-final.json .
```

Gitleaks' initial default directory scan found 6 generated Next/vendor matches.
A source scan excluding generated output found 11 existing Assessment storage-key
matches. The final configuration extends default rules, excludes generated
`node_modules`, `.next`, `graphify-out`, browser reports/results, and allows only
`assessment_engagement_v1` and `assessment_legacy_claim_v1` matches in the two
existing Assessment repository files. The final source scan found zero leaks.

Semgrep uses five locally authored JavaScript/TypeScript checks for eval/Function,
shell execution, disabled TLS validation, raw DOM HTML writes, and wildcard
credentialed CORS. This is a limited local rule set, not the registry's full
security suite. A first malformed YAML invocation failed before scanning and
was corrected. Final scan: exit 0, five rules on 644 JavaScript/TypeScript files, zero findings.

Trivy used the cached vulnerability database and checks, offline, and reported
zero high/critical vulnerabilities or misconfigurations. No pre-commit or
Promptfoo configuration exists in this checkout.

Graphify warned that `tree_sitter_sql` is missing, 77 files yielded no symbols,
and 9 existing nodes lack `source_file`. The first update rebuilt 6,638 nodes and 14,592 edges; the final incremental
update produced 6,646 nodes and 14,602 edges, with the SQL/parser metadata
warnings still present. No generated graph file is staged or committed.

## Files touched

Application files, all listed explicitly:

- `apps/platform/next.config.ts`
- `apps/platform/next.config.test.ts`
- `apps/platform/lib/server-config.ts`
- `apps/platform/lib/server-config.test.ts`
- `apps/platform/app/api/settings/domains/auth/route.ts`
- `apps/platform/lib/custom-domains-auth.test.ts`

Harness and dependency files:

- `tooling/e2e/dns-control.mjs`, `domain-route.ts`, `session.ts`, `tenants.mjs`
- `tooling/e2e/global-setup.ts`, `platform-server.mjs`, `run.mjs`
- `tooling/e2e/playwright.config.ts`, `safety.test.mjs`, `tsconfig.json`, `package.json`
- `tooling/e2e/specs/fixtures.ts`
- `tooling/e2e/specs/custom-domains.e2e.spec.ts`, moved and adapted from the deleted directory
- `tooling/e2e/specs/theming.e2e.spec.ts`, moved and adapted from the deleted directory
- `tooling/custom-domains-e2e/README.md`, deleted with the old directory
- `pnpm-lock.yaml`

Documentation:

- `docs/tooling/e2e.md`
- `docs/tooling/e2e-verification-2026-11-11.md`, this record
- `docs/runbooks/custom-domains.md`
- `docs/HANDOFF.md`
- `docs/SHIPLOG.md`, new dated entry only

Generated, deliberately uncommitted: `graphify-out/graph.json` and
`graphify-out/GRAPH_REPORT.md`. No migration, deployment definition or CI workflow
was edited. Existing CI service mode still selects the workflow's Postgres 17
service; local proof used the required pgvector image.
