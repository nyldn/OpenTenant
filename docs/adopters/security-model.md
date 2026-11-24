# Security model

OpenTenant separates installation authority, tenant authority and module
authority. The control plane and operators are trusted. Tenant content,
inbound headers, remote modules, provider responses and generated code are
untrusted. Local isolation tests are evidence for particular controls, not a
claim of certification or production approval.

## Request boundary

Trusted ingress establishes the hostname, then the platform resolves an active
verified tenant and validates a session bound to it. Mutations also enforce
permission and origin checks. Production unknown hosts fail closed. Local
identity and development tenant fallbacks are rejected in production.

Source: [middleware](../../apps/platform/middleware.ts),
[tenant resolution](../../apps/platform/lib/tenant.ts),
[session](../../apps/platform/lib/session.ts),
[settings guards](../../apps/platform/lib/settings-guard.ts).

## Database boundary

Each tenant has a separate database and restricted runtime login. Tenant-scoped
tables force RLS against transaction-local context and the tenant metadata
anchor. Runtime roles must have no superuser, role creation, database creation,
replication or RLS bypass privilege. Operator roles can bypass these controls
and therefore need separate custody and attributable use.

Connection records use AES-256-GCM with authenticated tenant binding and a
versioned key ID. Encryption protects stored credentials; compromise of the
runtime process and its active keyring can expose them. Backups need restricted
storage, transport encryption and matching key retention.

Source: [role provisioning](../../tooling/provisioning/src/app-role.ts),
[credential cipher](../../packages/database/src/credential-cipher.ts),
[tenant transaction wrapper](../../apps/platform/lib/tenant-db.ts).

## Module boundary

Remote modules receive scoped signed context, not ambient database secrets.
Capability requests are bound to a reviewed module version, live tenant
entitlement and revocable grant. Arbitrary SQL and arbitrary platform data
access are outside the capability contract.

Sandbox policy constrains workspace paths, commands, resources, network access
and previews. Optional provider adapters do not remove the approval gate for
hosted execution or the first callable Developer MCP route. Source:
[module context](../../packages/security/src/module-context.ts),
[capability broker](../../apps/platform/lib/module-capability-broker.ts),
[sandbox policy](../../packages/sandbox/src/policy.ts).

## Audit boundary

Append-only database controls protect normal runtime writes. An operator with
database-owner authority can change the database, so signed audit checkpoints
must live outside it under a separately held Ed25519 signing key. Verifiers
need only trusted public keys and external notes. A restore must verify against
notes from before the backup; re-signing restored data would not prove its
history survived.

Source: [checkpoint verifier](../../packages/database/src/audit-checkpoints.ts),
[checkpoint custody](../security/audit-checkpoints.md),
[restore drill](../../scripts/restore-drill.mjs).

## Operator responsibilities

Configure TLS, trusted ingress, provider credentials, least-privilege database
roles, protected backups and a separately scheduled checkpoint signer. Test
identity and tenant journeys against the deployment you operate. Decide
retention, residency, incident ownership and production RPO/RTO before genuine
tenant data is introduced. A Postgres region label is an assertion about server
placement, not geographic routing.

Keep secrets out of URLs in logs, Git, screenshots and support tickets. Review
redacted operational evidence instead. See the repository's
[threat model](../security/developer-mcp-threat-model.md) for the Developer MCP
assets, threats and launch requirements.
