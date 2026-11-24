# Multiple tenant identity anchor recovery

Use this runbook only when tenant-core migration reports:

```text
tenant_core has multiple identity anchors; automatic repair is prohibited
```

The migration has already failed closed. Its preflight runs under the migration
lock and transaction, restores FORCE RLS on rollback, does not add the singleton
column, and does not delete or select a tenant identity.

## Why owner action is required

More than one `tenant_core.tenant_meta` row means a database documented as
single-tenant contains conflicting ownership claims. Code cannot infer which
claim owns dependent module rows. Automatically keeping the newest, oldest, or
control-plane-matching row could silently misassign or destroy tenant data.

## Non-mutating diagnosis on an isolated clone

1. Stop application and worker writes to the affected database.
2. Create and verify a provider snapshot or isolated clone before inspection.
3. Confirm the database is the one mapped to the expected control-plane tenant.
4. Disconnect all application roles from the isolated clone. Use the table
   owner or another role allowed to alter `tenant_core.tenant_meta`; an ordinary
   application role cannot perform this inspection because canonical tenant
   tables use FORCE RLS.
5. Run the following transaction on the clone. The ACCESS EXCLUSIVE lock keeps
   other sessions out, and `rollback` restores FORCE RLS without committing a
   catalog change. Keep query output local; tenant identifiers must not enter
   tickets, logs, commits, or chat.

```sql
begin;
lock table tenant_core.tenant_meta, tenant_core.module_schema_versions
  in access exclusive mode;

select c.relname, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'tenant_core'
  and c.relname in ('tenant_meta', 'module_schema_versions')
order by c.relname;

alter table tenant_core.tenant_meta no force row level security;
alter table tenant_core.module_schema_versions no force row level security;

select count(*) as identity_anchor_count
from tenant_core.tenant_meta;

select tenant_id, data_region, provisioned_at
from tenant_core.tenant_meta
order by provisioned_at, tenant_id;

select tenant_id, count(*) as module_version_rows
from tenant_core.module_schema_versions
group by tenant_id
order by tenant_id;

rollback;
```

The first catalog query must report both flags as true for both tables. After
rollback, repeat that catalog query in a new transaction and prove
`rls_forced` is still true on both. If the role cannot lock or alter the tables,
stop and have the database owner perform this procedure; do not fall back to a
tenant-scoped query because it can hide conflicting anchors.

Inventory every installed tenant schema before choosing an anchor. Do not
assume `module_schema_versions` covers all tenant data.

## Owner decision and repair evidence

The owner must identify the authoritative tenant using the control-plane
mapping, provider inventory, creation evidence, backups, and module-row
inventory. For each non-authoritative identity, choose one of these outcomes:

- restore it to its own database;
- export and retain it under the approved retention policy; or
- authorize its deletion after proving it is synthetic or otherwise disposable.

Implement the chosen repair as a reviewed, database-specific script against the
isolated clone first. The script must name the approved tenant explicitly,
account for every dependent schema, abort on unexpected row counts, and run in
one transaction. A generic deletion command is deliberately not provided.

After clone verification, record the approver, snapshot/clone identifier,
before/after counts, exported artifacts, repair checksum, migration result, RLS
proof, and rollback point. Only then repeat the reviewed repair on the affected
database and rerun the complete tenant migration and isolation checks.
