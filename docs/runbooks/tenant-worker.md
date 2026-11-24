# Tenant worker and lifecycle

This runbook describes local-tested implementation. It does not authorize a
provider operation, production enablement, or genuine tenant data. Twenty and
Plane supplied no source code. The lifecycle sequence was supplied by the
operator and implemented against OpenTenant's schema.

## Process setup

Use Node 22.23.2 and pnpm 11.13.1. The worker uses pinned MIT-licensed
`graphile-worker` 0.16.6 on the control-plane PostgreSQL database. Keep the web
process and worker on the same source revision. Apply the control-plane
migrations, then install Graphile's own versioned schema before accepting jobs:

```sh
pnpm local:migrate
pnpm worker --migrate
pnpm worker
```

For a bounded local drain, use `pnpm worker --once`. The normal worker handles
SIGTERM/SIGINT and closes its shared control-plane pool. A Node process loader
handles workspace TypeScript and the same SQL assets consumed by provisioning.
No user table is created by a task. The heartbeat task and trigger route were
removed. Workflow remains solely because the unchanged Next configuration
still uses its build wrapper.

Set `CONTROL_PLANE_DATABASE_URL`, `TENANT_DB_ENCRYPTION_KEY`, the selected
identity adapter's configuration, and the provisioner configuration through the
existing installation configuration. Starting a normal worker with queued
provisioning or erase jobs can call the configured adapters. For local proof,
the integration tests inject fake adapters. Never point a local proof at hosted
services.

The crontab dispatches one helpdesk projection task per active tenant each
minute. A stable job key deduplicates pending passes. Each pass claims a bounded
outbox batch. Existing event/version guards make redelivery idempotent. The
projection task and lifecycle tasks share a per-tenant queue. A pass skips
suspended/deleted tenants. Export expiration runs every fifteen minutes. A reconciliation task exposes jobs
whose worker died on its final attempt as failed, so operators can retry them.

## Provisioning jobs

Creation requires an owner email and installation-owner authorization. The HTTP
route inserts tenant, brand, domain, job and audit rows in one transaction and
returns **202** with `tenantId`, `jobId` and a status-page Location. It performs
no identity or database-provider call. The status page at
`/admin/tenants/<tenantId>` shows attempts and status. Failed jobs offer a retry
button. Retries commit their audit record with the queue write.

Graphile bounds each execution series to five attempts with backoff. The worker
runs the existing database checkpoints, writes the owner invite, and activates
the tenant last. Connection values never enter the job payload. A Graphile
payload contains only the application job ID. A session advisory lock and
per-tenant queue serialize execution. Database steps remain idempotent; stale
legacy provisioning claims expire after fifteen minutes.

The identity organization API has no idempotency-key contract. Before calling
it, the worker durably marks `organizationAttempted`. If a process dies or the
provider outcome is ambiguous before the mapping persists, retries stop before
creating another organization. An operator must reconcile the adapter's
organization and tenant mapping before retrying. Do not clear this marker
without proving that no organization was created. No automatic compensation
deletes an organization whose creation outcome is unknown.

## Initial owner

The operator must already be an installation owner in `platform_users`.
Configure `OPENTENANT_OPERATOR_USER_ID` or supply `--operator <userId>`:

```sh
pnpm tenant:owner-invite --tenant <slug> --email <email>
```

The command reissues bootstrap only while no active owner exists. It revokes
the prior local capability and any outstanding provider invitation. It is not
an ownership-transfer command. Normal member invitation routes still cannot
request the owner role.

The identity gateway first issues a **member** invitation. The separate owner
claim expires after 72 hours. The control plane stores its SHA-256 digest, expiry,
revocation/consumption timestamps and membership reference. The raw token lives
only in a mode-0600 local delivery file. The command prints the file path, never
the token. The default delivery directory is `~/.local/share/opentenant/owner-invites`, configurable
with `TENANT_OWNER_INVITE_DIRECTORY`.

Deliver that file's claim token privately to the intended person. After they
accept the identity invitation and sign in with the invited email, they enter
the token at `/admin/tenants/<tenantId>/owner-claim`. The claim locks the tenant
and invite, rejects expired/revoked/consumed or email-mismatched tokens, consumes
it, audits it, and enqueues owner elevation in one transaction. The worker
requires that user's active membership and exact email before calling
`IdentityGateway.setRole`. Replays finish the same grant. Issuance, claim and
grant have distinct audit events. A provider issuance attempt is audited before
its external effect. A `.pending` delivery file after a lost commit
acknowledgement requires operator reconciliation, not another blind issuance.

Local identity intentionally has no provider invitations. The tests fake the
gateway, not its SQL persistence or audit path. Transactional email delivery is
outside this worker's scope.

## Suspend and resume

Installation owners can suspend and resume through the tenant operations page.
Each transition locks the tenant and commits an audit event. `currentTenant()`
returns null for suspended and deleted hosts. Existing API guards therefore
deny tenant access before tenant data calls. The root layout replaces content
with the suspended page. The request-scoped `tenantLifecycleForHost()` exposes
only a status for a verified domain and bypasses the old active-host cache.

`lib/tenant-lifecycle-policy.ts` exports `suspendedTenantResponse()` for shared
gates to adopt during integration. It is not wired into settings-guard in this
branch. Existing API status codes remain their generic 403/404 denials. No
middleware/runtime changes were made. Explicitly test integrations that obtain a
tenant ID without `currentTenant()` before making a universal HTTP-423 claim.

## Export

The installation owner requests an asynchronous export from the operations
page. Tenant tables in `tenant_core`, `brain`, and `support` are read through
the stored restricted application role and tenant RLS context. Control-plane
rows are filtered to the tenant. Credential ciphertext, capability hashes,
passcodes and worker inputs are omitted. One JSON file per table is placed in
a `tar.gz` archive. The platform requires the system `tar` executable.

`TenantExportSink` separates the job from storage. The local sink defaults to
`~/.local/share/opentenant/tenant-exports`; set `TENANT_EXPORT_DIRECTORY` to private persistent
storage outside a public web root. Files are mode 0600 within private
directories. The worker and web process must share that directory. Provision
storage for the largest tenant; this first implementation materializes each
table and the download in memory. It is not a streaming or point-in-time
backup. Tenant and control-plane snapshots can reflect different instants.

Download links require installation-owner authorization on every request,
are tenant-bound, audited, and expire after 24 hours. Responses prohibit caching.
Expired files are removed by the scheduled cleanup pass. Operators must also
monitor free space and remove crash-left temporary directories after confirming
no export is running. The sink interface permits future object storage without
changing tenant query authority.

## Delete and hard erase

Delete immediately marks a tenant deleted and schedules its hard erase.
`TENANT_DELETE_RETENTION_HOURS` defaults to 720 hours and accepts 1 through
87600 hours. Deletion cannot be resumed through the tenant UI. The durable
erase task refuses to run early, drops the checkpointed tenant project through
`TenantDatabaseEraser.deleteProject`, checkpoints that success, removes local
exports and owner-token delivery files, and removes control-plane rows.
Provider deletion treats an already-absent project as success.

The forward migration's owner-only SQL erase procedure traverses foreign-key
dependencies, removes immutable evidence within the erased tenant scope, then
deletes the tenant. It takes exclusive table locks while disabling the affected
user triggers, and restores them before commit. These operations roll back
together on failure. Run the worker as the control-plane schema owner, never
as the tenant application role. PUBLIC cannot execute the erase procedures.
Normal application updates/deletes remain blocked by immutable-evidence guards.
Shared tenant-owned modules must be retired before erase; the procedure refuses
to delete another tenant's module installation. A new dependency cycle fails
closed and needs a reviewed forward migration.

The last audit event belongs to the installation chain and contains a random
receipt identifier and `erased: true`, with no tenant ID, slug, owner email,
provider ID or tenant content. A crash after provider deletion resumes from the
database checkpoint; a crash after SQL commit finds no tenant and is a no-op.
The tenant's own chain is intentionally removed at hard erase. Off-host backups
and previously downloaded archives require the installation's separate retention
policy. No hosted erase was exercised for this change.

Migration numbers 0030-0039 are intentionally left unused in this worktree.
This work adds control-plane 0040-0044; tenant-core 0010-0011 remain reserved
and unused. The orchestrator may renumber new migrations before merge.

## Synthetic browser fixture

With an explicitly configured loopback control-plane database, run
`pnpm tenant:seed-e2e`. It reuses the canonical local seed and adds one failed
export job for `tenant_local`. It contacts no provider and creates no tenant
database. Start the web app with local identity, the local default tenant, and
the same database. Visit `/auth/local?return=/admin/tenants/tenant_local` to check
status and retry controls. Running the worker against this fixture will fail
export until a restricted tenant database is separately provisioned.

Integration cleanup: after heartbeat removal, the only production reference to
Workflow is `next.config.ts` importing/applying `withWorkflow`. Its config test
also mocks that wrapper. There are no remaining application Workflow imports
or `use workflow` / `use step` directives. The orchestrator can remove the
wrapper, config-test mock and dependency at merge. This branch leaves the
configuration untouched and ignores only the three exact generated route.js
paths in ESLint.
