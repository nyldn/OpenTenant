# Tenant provisioning

The hosted provisioning adapter can create one isolated database project per
tenant in the approved runtime account. Neon PostgreSQL is the selected hosted
implementation.
The `provisionTenant()` library in `tooling/provisioning` is the only approved
orchestration path. The platform-admin tenant route calls it through the
server-only provisioning service; there is currently no operator CLI or
standalone worker entrypoint.

The storage schema accepts `ap` for installations and future adapters. Automated
Neon provisioning currently accepts only `us` and `eu`; the admin API rejects
`ap` before any provider operation. No Asia-Pacific Neon mapping has been
selected or authorized. This preserves the existing provider boundary rather
than inventing a deployment region.

See [hosted migrations](hosted-migrations.md) for the separate operator command
for approved control-plane and tenant-fleet upgrades.

## Preconditions

- The control-plane tenant exists with status `provisioning` and a fixed
  `tenant_id`, URL-safe slug, selected-provider organization mapping, and `us`
  or `eu` data region.
- `OPENTENANT_TENANT_BASE_DOMAIN` is a hostname, with DNS and ingress configured
  for its tenant subdomains. It is required in production; development defaults
  to `example.test`. Tenant creation and commit reconciliation use this setting.
- `NEON_API_KEY`, `NEON_ORG_ID`, `CONTROL_PLANE_DATABASE_URL`, and
  `TENANT_DB_ENCRYPTION_KEY` are available to the trusted worker only.
- `NEON_ORG_ID` must identify the explicitly approved account. Paid provider
  changes require separate approval.
- A `provisioning_jobs` row exists for the tenant and is claimed once.
- Never print or persist a Neon owner URI. Store only the encrypted
  `tenant_app` URI, authenticated to `tenant_id` by the credential cipher.

## `provisionTenant()` flow

The approved job worker calls `provisionTenant(deps, input)` with `tenantId`,
`tenantSlug`, and `dataRegion`. External identity-provider organization IDs
remain only in the control-plane identity mapping:

1. Load checkpoint `{projectId, region, migrated, stored}`.
2. If project is missing, find deterministic project
   `opentenant-tenant-<tenantSlug>` before creating one. Regions map to
   `aws-us-east-1` for `us` and `aws-eu-central-1` for `eu`.
3. Record project ID and region immediately.
4. Fetch the owner URI in memory, apply `tenant-core`, and seed the tenant
   metadata anchor. Ensure `tenant_app` exists before applying `tenant-brain`
   then `tenant-support`. Each catalog tracks checksums and resumes separately.
   Module migrations own their grants and append-only revocations.
5. Record `migrated`.
6. Create or harden `tenant_app` with `NOBYPASSRLS`, least-privilege grants,
   and a rotated random password.
7. Encrypt and store the `tenant_app` URI in `tenant_databases`; record `stored`.
8. Mark the job completed, verify, then activate the tenant separately.

Do not activate a tenant after a partial run.

## Resume and failure behavior

Retry the same tenant input through the same job worker. The flow resumes at
the first incomplete checkpoint. If a crash occurred after Neon project create
but before checkpoint write, deterministic name lookup prevents a duplicate.
Migrations and connection storage must remain idempotent. Resumed jobs recheck
all schema catalogs, even when older code recorded `migrated` or `stored`. This
verification does not rotate a stored application password. Failure messages
record a fixed classification without provider or connection details.

The `provisioning_jobs` schema records `pending`, `running`, `failed`, or
`completed`, attempts and `last_error`, plus the `project_id`, `region`,
`migrated`, and `stored` checkpoint fields added by migration `0007`. The
approved job-store adapter reads and advances those fields directly. Do not
fake checkpoint completion by editing `provisioning_jobs`.

Inspect lifecycle state without exposing credentials:

```bash
psql "$CONTROL_PLANE_DATABASE_URL" --set=tenant_id="$TENANT_ID" \
  -c "select job_id,tenant_id,kind,status,project_id,region,migrated,stored,attempts,last_error,created_at,updated_at from provisioning_jobs where tenant_id = :'tenant_id' order by created_at desc;" \
  -c "select tenant_id,provider,region,schema_version,updated_at from tenant_databases where tenant_id = :'tenant_id';"
```

- `pending`: not claimed. Check worker health; do not create a second job.
- `running`: active or stalled. Confirm lease and checkpoints before retry.
- `failed`: preserve `last_error`, correct the cause, increment attempts, and
  resume the same job. Do not delete a project without proving it is orphaned.
- `completed`: require project, migration, encrypted record, role, RLS, and
  tenant metadata verification before tenant activation.

## Application-role and RLS verification

Run as the project owner. Expected booleans are login `true`; bypass, superuser,
createdb, createrole, and replication all `false`.

```sql
select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication
from pg_roles where rolname = 'tenant_app';

select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('tenant_core', 'brain', 'support') and c.relkind = 'r';
```

Then connect with `TENANT_APP_DATABASE_URL` and prove fail-closed behavior:

```bash
psql "$TENANT_APP_DATABASE_URL" --set=tenant_id="$TENANT_ID" \
  -c "select count(*) = 0 as no_context_returns_zero from tenant_core.tenant_meta;" \
  -c "begin; select set_config('app.tenant_id', :'tenant_id', true); select tenant_id,data_region from tenant_core.tenant_meta; rollback;"
```

Stop and treat as a security incident if `tenant_app` can read without context,
has elevated flags, sees a different tenant, or the stored region differs from
the tenant policy.
