# Concepts

## Tenant resolution

A request first resolves its normalized hostname to an active, verified domain
and tenant in the control plane. Custom domains also have verification expiry.
The request's authenticated session must then belong to that tenant. A caller
cannot select another tenant by submitting a tenant ID or inventing a header.
The trusted ingress must replace forwarded host information and prevent direct
access that bypasses it.

Development on loopback or explicitly configured development hosts also allows
a tenant override cookie and `PLATFORM_DEFAULT_TENANT_ID`. Production has no
fallback for an unknown host. Source:
[tenant resolution](../../apps/platform/lib/tenant.ts),
[middleware](../../apps/platform/middleware.ts),
[session binding](../../apps/platform/lib/session.ts).

## A database per tenant plus RLS

The control plane holds tenant metadata, provider mappings, entitlements and
encrypted connection records. Provisioning creates a database and restricted
runtime login per tenant. Tenant tables enable and force row-level security.
The application sets `app.tenant_id` inside the transaction, and the database's
single-tenant metadata anchor rejects a different tenant context. Missing
context returns no tenant rows. Database owners and superusers are trusted
operators, so application traffic must never use their connections.

Source: [Postgres adapter](../../tooling/provisioning/src/postgres.ts),
[canonical tenant preparation](../../tooling/provisioning/src/tenant-database.ts),
[RLS transaction wrapper](../../apps/platform/lib/tenant-db.ts),
[tenant anchor migration](../../tooling/migrations/sql/tenant-core/0003_single_tenant_anchor.sql).

## Signed module context

A remote module receives short-lived signed context with tenant, user,
permissions, audience and expiry. It verifies that context using the trusted
public key before acting. It receives no platform database connection. Replay,
audience and signature checks constrain where and when the authority is valid.
Treat module-generated responses as untrusted too.

Source: [signing and verification](../../packages/security/src/module-context.ts),
[SDK exports](../../packages/module-sdk/src/index.ts),
[remote module proxy](../../apps/platform/app/m/[module]/[[...path]]/route.ts).

## Capability broker

A capability grants a reviewed fixed operation, scoped to tenant, module and
version. The broker rechecks the live entitlement and grant, then runs the
operation under tenant context. Revoking a grant or disabling the entitlement
stops further access. The initial support-summary capability returns a limited
projection, not arbitrary SQL or a database credential.

Source: [broker](../../apps/platform/lib/module-capability-broker.ts),
[SDK capability contracts](../../packages/module-sdk/src/capabilities.ts).

## Audit chain

Audit events form a hash chain per tenant and a platform chain. Append-only
triggers block updates, deletes and truncation by ordinary runtime roles.
A separate signer publishes Ed25519-signed head checkpoints outside the
database. Verification recomputes the chain against those trusted external
notes, detecting rewritten history and missing tails even if database receipts
were removed. A database backup alone is not the checkpoint trust root.

Source: [audit store](../../packages/database/src/audit-store.ts),
[chain verifier](../../packages/security/src/audit-chain.ts),
[checkpoint operations](../../packages/database/src/audit-checkpoints.ts).

## Entitlements and permissions

An enabled, version-bound tenant module entitlement controls availability.
Identity membership and authorization decide what the current user can do.
A module access policy can require identity or a passcode, and brokered data
still needs its own capability grant. These checks answer different questions;
a passcode does not make its holder a tenant administrator.

Usage records provide immutable metering evidence. They do not define pricing,
subscriptions or billing rights. Source:
[entitlement contracts](../../packages/platform-core/src/modules.ts),
[access policies](../../apps/platform/lib/module-access.ts),
[authorization](../../packages/authz/src/port.ts),
[usage ledger](../../packages/database/src/usage-ledger.ts).
