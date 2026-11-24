# OpenTenant architecture

Status: accepted baseline, updated 2026-07-21

## 1. Product boundary

OpenTenant is a multi-tenant application platform. It supplies reusable
identity, tenant routing, branding, module lifecycle, data isolation,
credential brokering, audit, and operations so tenant applications can focus
on their workflows.

OpenTenant is not a consultancy-specific application, a single assessment, or
a hosting wrapper around one tenant. Example modules exist to prove contracts
and are replaceable.

One installation has one multi-tenant owner—such as an agency, SaaS company, or
enterprise platform team—and one or more independently configurable tenants.
The detailed owner console, managed-support, module-scope, and helpdesk design
is defined in [multi-tenant operations](multi-tenant-operations.md).

## 2. Goals

- Resolve every request to exactly one tenant before data or module access.
- Compose native and remote modules behind stable manifests and entitlements.
- Keep identity, database, deployment, and sandbox providers replaceable.
- Make privileged state changes attributable and tamper-evident.
- Let tenants control approved branding, membership, modules, navigation, and
  connections without obtaining platform credentials.
- Support tenant developers and AI coding agents through a separate,
  least-privilege Developer MCP and isolated workspaces.
- Run locally without cloud-provider accounts.

## 3. Non-goals

- Shared credentials or a shared mutable schema for all tenant application
  data.
- Trusting tenant identity from caller-controlled headers.
- Loading untrusted module code into the platform process.
- Exposing provider SDK objects, IDs, or tokens as module contracts.
- Silent production publication by an agent.
- Assuming one cloud account, region, public domain, or commercial plan.

## 4. Repository topology

The pnpm/Turborepo workspace contains:

- `apps/platform`: Next.js shell and server composition roots;
- `modules/*`: native example modules;
- `packages/*`: provider-neutral domain contracts and shared infrastructure;
- `tooling/migrations`: control-plane and tenant-plane SQL;
- `tooling/provisioning`: optional provider adapters;
- `packages/sandbox`: isolated development execution contract.

Imports point inward toward provider-neutral contracts. Provider SDKs stay in
adapters or application composition roots. Modules do not import the control
plane, identity provider, or deployment provider.

## 5. Request lifecycle

1. Middleware removes caller-supplied trusted-context headers.
2. The server normalises the host and resolves an active tenant.
3. Identity normalises the session and confirms membership for that tenant.
4. Module entitlement and permission policy resolve the allowed navigation and
   action set.
5. Database access selects the tenant-bound connection and sets the RLS tenant
   context inside a transaction.
6. Privileged changes and their audit evidence commit together.
7. Remote modules receive only a short-lived, module-bound signed context.

Any missing or contradictory binding fails closed.

## 6. Administrative boundaries

Multi-tenant-owner administrators (also called platform administrators in the
current implementation) may create, suspend, and recover tenants; configure
locked brand and legal fields; register installation-owned modules; inspect
global audit health; and operate provider adapters. OpenTenant release modules
remain platform-owned and cannot be published through an installation-owner
permission.

Tenant owners and delegated administrators may manage their own membership,
approved brand fields, module enablement, navigation, and external connections.
They cannot alter another tenant, unlock platform policy, retrieve raw
credentials, or grant themselves platform authority.

## 7. Tenant resolution and domains

The control plane maps verified hostnames to stable internal tenant IDs.
Unknown or malformed hosts return a generic 404 without tenant detail. Local
development may use an explicit tenant override or default tenant only on
loopback hosts. Production never honours this override.

Custom domains require ownership verification before activation. Cache entries
are short-lived, tenant-bound, and invalidated on status/domain changes.

## 8. Identity and authorization

`IdentityGateway` is the application contract. Each hosted installation selects
either WorkOS or Clerk; providers are not mixed between tenants in one
installation. `LocalIdentityGateway` is a single-user non-production adapter.
A future provider must produce the same internal session, organisation,
membership, and administration model.

Internal user, tenant, and membership IDs are stable and distinct from
provider IDs. A session carries one active tenant, one tenant role, explicit
permission slugs, platform-admin status, and expiry. Permissions—not provider
role names—gate operations. Provider organisation and resolved tenant must
agree.

External OAuth connections use browser consent, state/PKCE where applicable,
minimum scopes, encrypted refresh tokens, provider-side revocation, and an
audited disconnect path.

## 9. Data planes and isolation

The control plane stores tenant registry, domains, brand policy, module
catalog/entitlements, identity links, encrypted connection records,
provisioning checkpoints, OAuth vault records, and audit events.

Tenant application data lives in a tenant-specific database or equivalent
isolated resource selected by a provider-neutral locator. Neon PostgreSQL is
the selected hosted data plane; the existing contract also supports other
PostgreSQL records and does not assume an account.

Every shared tenant table enables and forces row-level security. Policies read
`current_setting('app.tenant_id', true)` and fail when it is absent. Application
access uses a non-bypass role and a transaction-scoped `set_config`. Migration
connections remain separate from application connections.

Connection strings are encrypted with AES-256-GCM and tenant ID as
authenticated data. Moving a record to another tenant makes decryption fail.

## 10. Branding

Brand resolution order is platform defaults, platform-admin tenant defaults,
tenant-admin overrides for unlocked fields, then module presentation mapping.
The result is an immutable `BrandSnapshot` used by shell, modules, exports, and
metadata.

Only typed tokens are configurable. Asset URLs are same-origin allowlisted
paths; arbitrary CSS, scripts, or external asset hosts are not accepted. The
repository ships neutral OpenTenant and example-tenant fixtures only.

## 11. Module contract

A versioned `ModuleManifest` declares stable key, runtime, navigation items,
permissions, settings, health, and compatible platform version. Tenant
entitlements select enabled modules; session permission resolution selects
available actions.

Native modules are trusted packages compiled with the platform. Tenant-created
or third-party modules are remote and execute outside the platform process.
Remote composition is path-based and uses a short-lived Ed25519 context bound
to tenant, user, module key, permissions, brand, issue time, and expiry. The
module verifies with a public key and never receives the signing key.

## 12. Example modules

The generic assessment module proves native UI composition, tenant branding,
local-first state, server-enforced access modes, telemetry allowlists, exports,
and deterministic scoring tests.

The knowledge module proves provenance, connector, retrieval, human-promotion,
and MCP boundaries. The support module proves tenant-local numbering,
transactional audit, triage, and internal/public note separation.

Example content is synthetic and must not name or reproduce a real tenant.

## 13. Observability

Telemetry uses an allowlist of content-free events. Every event is tenant,
module, version, and time attributable; arbitrary properties, answer content,
prompts, tokens, and database values are rejected or redacted.

Health separates platform, provider, and module state so one adapter failure
does not imply cross-tenant data access or corrupt the control plane.

## 14. Audit and secrets

The canonical audit store is an append-only per-scope hash chain. Each event
records actor, tenant, action, subject, safe details, prior hash, and current
hash. Privileged mutations append through the same transaction where
applicable. Provider audit export may replicate curated events but never
replaces the canonical chain.

Verification reports its assurance explicitly. `canonical` means every event
uses canonical JSON and binds tenant scope; `legacy-unbound` means the exact
historical digest still verifies but at least one prefix event predates tenant
binding; `unverified` means a sequence, previous-hash, digest, or hash-format
transition failed. Once canonical evidence begins, a later legacy-format event
is rejected as a downgrade. Historical rows are never rewritten or silently
re-anchored: PostgreSQL `jsonb` does not preserve the original textual/key-order
representation, so a non-matching legacy digest cannot be distinguished from
tampering and remains unverified. This follows the authenticated-log rule that
evidence is not treated as authentic before its exact hash/signature validates.

References: [PostgreSQL JSON types](https://www.postgresql.org/docs/17/datatype-json.html)
and [RFC 5848 signed syslog messages](https://www.rfc-editor.org/rfc/rfc5848.html).

Secrets live in ignored environment files or a selected secret manager. They
are never placed in module context, client responses, logs, error messages,
generated code, sandbox environments, or artifacts. Brokered calls inject a
credential only at the approved network boundary.

## 15. Developer MCP and sandboxes

The Developer MCP is separate from knowledge retrieval. It authenticates a
tenant developer or delegated AI-assisted administrator, exposes only their
allowed tools/resources, and creates tenant-private remote modules.

All generated code runs through `SandboxAdapter`: create, write, bounded
structured command, authenticated preview, checkpoint/restore, logs,
artifacts, and deterministic termination. The OpenTenant control plane owns
identity, policy, quotas, state, and audit; the sandbox provider owns only
workspace execution. Unsupported security-critical capabilities fail closed.

Publication requires immutable evidence and explicit human authority. The
future Module Improvement Lab may propose and compare changes, but cannot
self-approve or silently deploy.

## 16. Verification

Required automated evidence includes:

- host and tenant resolution including malformed/cross-tenant cases;
- identity tenant binding, revocation, and permission denial;
- RLS without context, wrong context, and correct context;
- encryption authenticated-data swaps and key errors;
- audit chain append, mutation rejection, and tamper detection;
- module-context signature, expiry, and module-key binding;
- sandbox policy, conformance, cleanup, and secret-safe errors;
- generic assessment scoring and persistence compatibility;
- build, typecheck, lint, unit tests, secret scan, and public-identity scan.

Manual hosted checks are separate, explicitly approved probes. They record
account-independent provider capability, region, retention, cost, protection,
and deletion evidence.

## 17. Local-first and hosted operation

Local development uses Docker PostgreSQL, checked-in migrations, synthetic
seed data, and local identity. No cloud provider or model key is required for
the main shell and deterministic tests.

Hosted operation targets Vercel for application hosting and hosted sandbox
execution, WorkOS or Clerk for identity and authorization, and Neon PostgreSQL
for the control and tenant data planes. Provider adapter configuration is
supplied at runtime and must not assume a particular account or resource ID.
New hosted testing begins only in owner-approved test-only accounts and never
reuses a tenant's infrastructure by default.

The boundaries permit future alternatives, but do not imply current support.
For example, a future Supabase PostgreSQL adapter would still need explicit
provisioning, migration, isolation, recovery, and production evidence.

## 18. Delivery sequence

1. Maintain the implemented local-first platform and isolation gates.
2. Maintain the completed synthetic module-template sandbox orchestration proof.
3. After permissions and schemas are approved, expose the first read-only
   Developer MCP authentication and workspace tools.
4. Add immutable publication and remote-module registration.
5. Add brokered tenant capabilities one class at a time.
6. Pilot the Module Improvement Lab in Observe mode only after its privacy and
   quality-contract gates exist.
