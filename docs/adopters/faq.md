# FAQ

## Do I need Neon, WorkOS or a model key to try it?

No. The [local quick start](getting-started.md#try-the-full-platform-locally)
uses Better Auth and Postgres. The control-plane setup uses local identity. Durable tenant provisioning can use operator
Postgres. Better Auth is the self-hosted organization-capable identity choice.
External model providers are not required for the local platform core.
See [providers](providers.md).

## Why does Assessment work while Support has no database?

The control-plane setup seeds the tenant and its entitlements. Run
`pnpm local:demo` to try Support with a provisioned tenant database. Assessment's basic example keeps synthetic browser-local state.
Support persistence requires provisioning and an encrypted runtime connection
record. Follow [first provisioned tenant](getting-started.md#your-first-provisioned-tenant).

## Can I create a second tenant with local identity?

The local adapter supports explicit synthetic `LOCAL_USERS` identities, but
its organization provisioning port is unavailable. Use Better Auth, WorkOS or
Clerk for the worker's full tenant lifecycle. Do not use local identity in
production. Source: [worker](../../apps/platform/workflows/tenant-worker.ts),
[identity composition](../../apps/platform/lib/identity.ts).

## Does changing app.tenant_id let a module access another tenant?

Modules do not receive a database connection. Runtime data access also requires
the correct restricted login, database and tenant anchor. A mismatched context
returns no rows. The [restore drill](../runbooks/backup-restore.md) checks this
again after restore. Database-owner credentials remain privileged.

## Why does the worker not read my .env.local?

Next loads its application environment file. Plain Node operator processes
expect exported variables. Load a protected environment into the process that
runs `pnpm worker`, migration, key rotation or audit commands. See the
[worker entrypoint](../../apps/platform/workflows/worker.ts) and
[operations](operations.md).

## Is a successful restore drill a production recovery guarantee?

No. It measures a small quiesced synthetic dataset on one disposable local
server, retains cluster roles and uses the same generated encryption keyring.
It proves logical database recovery and its listed checks. It does not test
point-in-time recovery, recovery of cluster roles on a new server, a lost
keyring, regional failover, live traffic or provider backup retention.
Production RPO/RTO stay operator-decided.

## Are usage events invoices?

No. The [ledger](../../packages/database/src/usage-ledger.ts) records exact
usage evidence. Export adapters send that evidence; they do not choose prices,
collect payments or grant entitlements.

## Can I install remote modules and run generated code immediately?

The SDK, starter, signed-context boundary and optional sandbox adapters exist.
Publication and hosted execution still require reviewed installation wiring
and owner approval. See [module setup](getting-started.md#adding-your-own-module)
and [security](security-model.md#module-boundary).

## What licence applies?

The [licensing map](../../LICENSING.md) distinguishes AGPL core, Apache SDK and
starter, CC-BY-SA documentation and reserved trademarks. Review those terms for
your intended distribution or hosted use. Public package publication is a
separate release step; the presence of source does not establish publication.

## Where are planning and review records?

They remain in the [full documentation index](../README.md). Adopter guides
explain current behavior and source; historical plans may describe work in
future tense. Do not treat an old plan as a supported product contract.
