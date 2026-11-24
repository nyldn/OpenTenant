# Database backup and restore

OpenTenant treats the control plane and every tenant database as separate
recovery units. Provisioning supports operator-owned Postgres and hosted Neon; no
account, organisation, project, region, or restore window is canonical.

## Recovery objectives

- Production RPO: `[SET BY OWNER]`
- Production RTO: `[SET BY OWNER]`
- Restore drill frequency: `[SET BY OWNER]`
- Evidence retention: `[SET BY OWNER]`

These values and the provider retention settings must be approved before
production use.

## Executable synthetic drill

From the repository root on Linux, with Node 22.23.2, pnpm 11.13.1, Docker and
`pgvector/pgvector:0.8.2-pg17-bookworm` already cached:

```sh
pnpm restore:drill
# Optional: retain only the secret-free JSON measurement report.
RESTORE_DRILL_REPORT=/tmp/restore-drill.json pnpm restore:drill
```

The [package script](../../package.json) always wraps
[scripts/restore-drill.mjs](../../scripts/restore-drill.mjs) in
`pnpm db:ephemeral`. The harness starts a unique disposable server on a random
loopback port and cleans it up on completion or failure. A second, short-lived
container from the same cached image runs the matching Postgres 17 clients.
The client uses Linux host networking to reach that loopback proxy. Neither
container pulls an image during the drill. Other Docker platforms need a
Linux runner; this command fails explicitly there.

The drill creates a uniquely named control-plane database, applies the real
control-plane catalog, then calls `provisionTenantProject` with
`PROVISIONING_PROVIDER=postgres` for two synthetic tenants. It generates a
fresh AES keyring and Ed25519 signing key in memory. Existing application
configuration and provider credentials are not used. The fixture contains
four support tickets per tenant and nine audit events across the platform and
two tenant scopes. Never replace this fixture with real tenant data.

The procedure is executable and fails if any proof fails:

1. Stop synthetic writes and run `pnpm audit:anchor` to persist three signed
   checkpoints outside Postgres, in a private temporary directory.
2. Record every user table's count and compare all `schema_migrations` IDs and
   SHA-256 checksums against the canonical control-plane/core/brain/support
   catalogs. Take one `pg_dump -Fc --create` backup per database.
3. Close application pools, start the recovery timer, and destroy all three
   databases. Recreate them from the archives with `pg_restore --create
   --exit-on-error --dbname=postgres`. Database ACLs are restored by the archive.
4. Check exact migration IDs/checksums and all table counts again. Decrypt both
   restored connection records with the generated configured keyring. Reject
   a credential decrypted with the other tenant's authenticated binding.
5. Connect through each decrypted restricted login. Check role flags, enabled
   and forced RLS on every tenant-scoped table, four visible own tickets,
   zero rows across every tenant table with no context or a forged other-tenant
   context, and denied
   connection to the other tenant's database.
6. Run `pnpm audit:verify` against the unchanged pre-backup external notes,
   without supplying the signing key or re-anchoring. Check all three scopes
   and confirm the checkpoint file hashes have not changed.
7. Stop the recovery timer after verification and print the JSON report.
   Remove archives, temporary notes, fixture databases, runtime roles and
   containers. A failed check exits nonzero; there are no successful skips.

The report includes recovered rows, checked tables/migrations, decrypted
connections, signed scopes, lost rows, measured RPO/RTO and recovery-point age.
RPO is **0 seconds for this quiesced workload** when every pre-backup row is
recovered. No post-backup writes are simulated. Recovery-point age measures
elapsed time from the final synthetic write to destruction, not lost data.
RTO runs from immediately before database destruction through successful
restore and all verification, excluding initial setup and final cleanup.

The CI `restore-drill` job runs this same command and uploads only the
secret-free JSON report. A local proof on 2026-11-11 recovered 8 tickets and
9 audit events in 3 databases, verified 67 migration records and 136 table
counts, checked 62 forced-RLS table instances, decrypted 2 connection records
and verified 3 signed scopes. Measured RPO was 0 seconds, RTO 52.775 seconds,
and recovery-point age 14.361 seconds. These measurements are observations of
a small synthetic fixture, not production targets.

Logical database backups do not include cluster roles. This drill retains the
original cluster roles and uses the same generated keyring; it does not prove
recovery of lost role credentials, lost keys, PITR, live concurrent writes,
regional failover or a production traffic cutover. Maintain separately protected
role/ACL and keyring recovery procedures. Retain every key needed by a retained
backup, as described in [key rotation](encryption-key-rotation.md).

## Provider recovery inventory

For a provider recovery exercise, reconcile the approved project inventory with
control-plane bindings without logging connection strings. Use an isolated
recovery target and an approved timestamp or LSN. Verify known synthetic
fixtures, catalog checksums, roles, RLS, tenant metadata, counts and external
checkpoints before considering traffic changes. Provider-specific restore and
retention settings require the installation owner's decision.

## Production restore

1. Declare an incident, stop writes, preserve evidence, and obtain incident
   lead plus data-owner approval.
2. Validate the exact timestamp or LSN in an isolated recovery target. Never
   guess a recovery point.
3. Record the current project, branch, endpoint, tenant, schema, and last known
   good transaction without exposing credentials.
4. Preserve the pre-restore state, then execute the documented provider restore
   only after approvals.
5. Treat restore requests as non-idempotent: on timeout, inspect provider
   operations before retrying.
6. Re-run migration, role, RLS, isolation, health, and application smoke checks
   before reopening traffic.
7. Monitor through a defined stability window and retain the preserved state
   until incident review authorises cleanup.
