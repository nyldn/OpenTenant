# Hosted database migrations

Use Node 22 and pnpm 11.13.1. This command is separate from `local:migrate`,
whose loopback guard is unchanged. Running it against a provider requires the
owner's approval for that exact installation and operation. Local rehearsal
uses disposable databases and makes no provider calls.

Supply the direct owner connection through the environment or a protected,
ignored manifest. Application connections use `tenant_app` and cannot migrate.
Never paste connection strings into command arguments, logs, issues, or reports.
Back up the databases and confirm restore evidence before an approved rollout.

## Control plane

Set `CONTROL_PLANE_DATABASE_URL` through the installation's secret manager.
Confirm its host explicitly, including a port if the URL specifies one:

```sh
pnpm migrate:hosted control-plane --target db.example.test --dry-run
pnpm migrate:hosted control-plane --target db.example.test
```

The dry run lists pending migration IDs and validates recorded checksums and
ordering in a read-only transaction. It creates no tracking table and runs no
DDL, seed, or baseline. An exact legacy tenant-core baseline is verified only
during apply; the dry run lists its unrecorded migrations as pending.

## Tenant fleet

Prepare an ignored JSON file with an array of `{tenantId, databaseUrl}` entries.
Each URL must be the tenant's direct owner connection. Obtain it through approved
operator tooling; the control plane stores restricted application credentials,
which are insufficient for this operation. Protect and remove this file using
the installation's secret-handling procedure. Do not commit it.

```sh
pnpm migrate:hosted tenant-fleet --manifest /protected/fleet.json \
  --canary tenant_canary --target first.db.example.test \
  --target second.db.example.test --dry-run
pnpm migrate:hosted tenant-fleet --manifest /protected/fleet.json \
  --canary tenant_canary --target first.db.example.test \
  --target second.db.example.test
```

Every URL host must match a `--target` before any database connection is made.
Query-string connection overrides are rejected; supported URL options are
`sslmode`, `sslrootcert`, `sslcert`, and `sslkey`. Keep TLS hostname verification
enabled on hosted connections. Duplicate tenant IDs and unknown flags fail.

The canary runs first, then the remaining manifest entries run sequentially.
Output contains tenant IDs, pending migration IDs, and completion or failure,
without connection strings or database error details. Any failure stops the
rollout. Re-run the same command after correcting the cause. Already recorded,
checksum-matching migrations are skipped. Never edit an applied SQL file.

Tenant order is core, brain, then support, each with its own tracking prefix.
The tenant must already have its metadata anchor and application role from
provisioning. Module migrations retain their explicit table grants and
append-only revocations. They require pgvector for brain. This command does not
create projects, discover provider credentials, rotate passwords, or activate
tenants. For a provisioning failure, resume the provisioning job instead.

## Verification

Before approving a hosted rollout, run migration execution, restricted-role RLS,
and database-store proofs on a disposable Postgres 17 server with pgvector,
using the environment variables in `.github/workflows/ci.yml`. The separate
production-provisioning integration test uses dedicated control-plane and tenant
URLs and fakes only the Neon API. A skipped integration test or missing pgvector
is not proof. Use `/api/health` for liveness and `/api/ready` for control-plane
readiness. Both routes retain middleware hostname validation. Readiness returns
an uncached 503 with no database details on failure.
