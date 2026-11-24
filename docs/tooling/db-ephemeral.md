# Disposable database proofs

## Current receipt note, 2026-11-17

The [V1 inventory](../../tooling/ci/db-sequence-inventory.md) supersedes the
Nov 11 counts below: 17 database-sequence steps, 358 cases and zero skips;
406 RLS checks across 41 tables; the separate full migration package passes
178 with zero failures/skips. These overlapping suites are not additive totals.
V1 records 115/115 quality tasks. E11 has not rerun those commands.
GitHub Actions is billing-blocked, so these are local receipts. See the
[E11 ledger](../plans/2026-11-17-e11-reconciliation.md). Marketing impact: none.

Run Node 22 and pnpm 11.13.1 with local Docker. Load
`pgvector/pgvector:0.8.2-pg17-bookworm` into Docker before starting. The harness
never pulls images or contacts a registry. Public npm dependencies are pinned
in `tooling/db-ephemeral/package.json` and the root lockfile.

```sh
pnpm db:ephemeral -- pnpm rls:proof
pnpm db:ephemeral -- pnpm database:store-proof
pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test
```

Each command gets a unique container with Docker networking disabled. PostgreSQL
listens on container loopback. On Linux, a private bind-mounted Unix socket
feeds a controller-owned TCP proxy. Local socket authentication requires SCRAM;
the container UID can write only the socket subdirectory of a private parent.
On other platforms, the proxy relays the binary protocol through bounded
`docker exec` processes. It binds a random host port on `127.0.0.1`; host port
5432 is rejected. The exec fallback needs no route to a container IP or
shared Unix socket support. Its additional latency may affect tight test
deadlines, so the native Linux transport is used for the CI-equivalent proofs. Docker or
pgvector unavailability fails the command. It never converts a skipped proof
into success. The store helper still checks the exact suite inventory, titles,
assertion counts and zero skips. Migration suites receive all three integration
URLs so their integration cases execute.

`startEphemeralPostgres()` exports `adminUrl`, `appUrl`, `port`, and an async,
idempotent `dispose()`. It creates a restricted application login and an empty
application database. It applies no migrations and installs no extensions. It
checks that the image has pgvector available. Call `dispose()` in `finally`.
The CLI additionally creates the empty databases using the existing CI helper.

The CLI exports `ADMIN_DATABASE_URL`, `DATABASE_URL`, the three
`*_INTEGRATION_DATABASE_URL` variables, both `PROVISIONING_*_DATABASE_URL`
variables and every URL declared by `STORE_SUITES` in
`tooling/ci/run-database-store-tests.mjs`. Explicit harness values replace stale
inherited database targets. On Linux it also sets
`OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT=1`. The CI connection validator accepts a
null server address and port only with this explicit local socket option.
It still verifies the client connection parameters, loopback peer, host port
and database name before any destructive setup. The admin URL is used for destructive synthetic
proofs. The application URL returned by the library is a separate restricted
login. Connection strings are never printed or passed as process arguments.

Commands run as argv arrays without a shell, with a 30-minute limit. The CLI
forwards SIGINT/SIGTERM, kills the child process group after a short grace
period, and disposes resources on success, failure or cancellation. An
independent cleanup process observes the controller pipe closing on abrupt
exit, including SIGKILL and worker termination. It receives only randomly
assigned Docker resource names and removes the container and volumes.
This explicit cleanup avoids downloading a Ryuk image. Docker itself must stay
available for removal. No cleanup mechanism can remove resources while the
Docker daemon is unavailable; the CLI treats disposal errors as failures.

CI keeps its existing three service containers. Their setup already matches the
proof inventory, and retaining them avoids coupling CI startup to this local
wrapper. Exact executed-count checks remain in the existing proof helpers.

## Unattended controller

`tooling/unattended/src/postgres-proof.mjs` keeps its synchronous prepare,
complete, cleanup and child-environment contracts. A worker runs Testcontainers
and owns a private Unix socket proxy to loopback PostgreSQL. The verification
sandbox still has networking disabled and receives only its authorized Unix
socket. Docker sockets and administrator credentials never enter that sandbox.
The helper needs a local `psql` client, discovered on PATH or in its previous
PostgreSQL 17 locations. It no longer needs a host PostgreSQL server.

The former initdb, pg_ctl, custom HBA, PID-file, data-directory and socket inode
checks are removed. Docker owns the cluster directory and container identity;
the agent cannot mount or modify them. A private socket directory and read-only
sandbox prevent socket substitution. SQL corroboration checks the cluster's
system identifier and start time against their values before verification.
The controller closes the proxy, disables the restricted login and terminates
its sessions before corroboration. Role restrictions, connection and statement
limits, protected controller ref, helper digest and fail-closed SQL assertions
remain. The shared harness and lockfile are part of the protected controller.
Failed containers are removed; bounded sanitized failure packets preserve the
useful diagnostics instead of retaining credentials, writable proof homes and
database directories.

The container has networking disabled, so PostgreSQL cannot initiate external
connections. Only its loopback port and the private Unix socket are exposed.
The implementation agent still receives no database credentials. Only the proof
child receives its generated restricted-role password through its environment.

## Failure feedback

`pnpm unattended:status` includes structured failure packets;
`pnpm unattended:failures` lists them directly. They live in controller-owned,
ignored `.opentenant/unattended/failures.jsonl`, with task id, failed argv,
redacted log tail capped at 8 KiB, files touched, original diff base, checkpoint
and attempt number. The agent cannot write that state.

`pnpm unattended:prompt` includes the latest packet for the task awaiting
verification. A failed verification or work review returns the same task to its
implementation agent on the next run, with that packet marked as untrusted
diagnostic data. It does not change acceptance criteria, commands or allowed
paths. Every repair is checked against the original trusted backlog and the
whole accumulated diff. At most two repair runs follow the original failure;
a third failure changes only the active task's status to `blocked`. Recovery
with no failure packet keeps the previous verification-only behavior.

## Verification, 2026-11-11

All databases used synthetic data and the pinned CI image. No provider,
production, push or PR operation was performed. Marketing impact: none.

| Command | Result |
| --- | --- |
| `pnpm db:ephemeral -- pnpm rls:proof` | 314 checks across 31 tenant tables passed. |
| `pnpm db:ephemeral -- pnpm database:store-proof` | 7 suites, 30 assertions, zero skips. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test --hookTimeout=60000 --testTimeout=60000` | 21 files, 148 tests, zero skips. |
| `node --test tooling/unattended/src/postgres-proof.integration.mjs` | 2 live cases passed, including 3 restricted-role migration assertions and rejection of empty evidence. |
| `node --test tooling/db-ephemeral/lifecycle.integration.mjs` | 2 live cases passed, including cleanup after SIGKILL. |
| `pnpm --filter @opentenant/unattended test` | 106 passed, zero skips. |
| `pnpm --filter @opentenant/db-ephemeral test` | 5 passed, zero skips. |
| `pnpm --filter @opentenant/ci test` | 33 passed, zero skips. |
| `pnpm turbo typecheck lint test --force --concurrency=2` | 69/69 tasks passed, zero cache hits. |
| `pnpm turbo build --filter=@opentenant/platform` | 1/1 task passed, zero cache hits. |
| `git diff --check` and `git diff --cached --check` | Passed. |
| `pnpm quality:matrix` | 23 workspaces, 69 tasks, zero builds. |
| `pnpm install --frozen-lockfile --ignore-scripts --offline` | Passed, no lockfile changes. |
| `pnpm audit --prod --audit-level high` | Zero high or critical findings; one existing moderate advisory. |

An initial full `pnpm turbo typecheck lint test --force` run passed 69 of 69
tasks. Later concurrent runs hit existing platform five-second import deadlines
on this busy host. The final full run uses `--concurrency=2`; it runs the same
69 tasks without increasing platform test deadlines. The ordinary root run
skips database suites without URLs; the dedicated migration run executed all
148 tests with zero skips. The migration command uses
60-second hook/test limits because the default ten-second schema setup deadline
expired under load. No assertion or executed-count check was removed.

Gitleaks scanned a repository source snapshot with the repository-relative
allowlist and found zero leaks. Semgrep ran five local rules over the changed
tooling directories with zero findings. Its first whole-repository attempt
failed on host io_uring allocation; the successful scan used `EIO_BACKEND=posix`
and one worker. Trivy's cached offline scan found zero high/critical production
dependency vulnerabilities. No pre-commit or Promptfoo configuration exists.

The unattended source diff removes 641 lines and adds 382, including tests.
`postgres-proof.mjs` shrinks from 693 to 220 lines; its asynchronous worker adds
86 lines. Ripwire reports zero gating regressions, with minor complexity and
size signals in the existing orchestration functions. Graphify was refreshed
using AST extraction and remains uncommitted; existing SQL-parser and semantic
metadata warnings remain.
