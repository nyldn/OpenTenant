# OpenTenant platform capabilities

Status: reconciled against committed wave-6 evidence, 2026-11-17

This guide explains the platform in human terms: what each part is for, what is
implemented, what has only been tested in a development provider account, and
what still needs a product or production decision.

Use the [architecture](../architecture/platform-architecture.md) for exact
system boundaries, the [changelog](../../CHANGELOG.md) for the sequence of
iterations, and the [ship log](../SHIPLOG.md) for detailed evidence.

## Current evidence, 2026-11-17

The [E11 reconciliation ledger](../plans/2026-11-17-e11-reconciliation.md)
links each correction to its committed receipt. V1 records 17 database sequence
steps and 358 cases with zero skips, 406 RLS checks across 41 tables, 178 full
migration tests with zero failures/skips, and 115 quality tasks. At `d818389`,
browser listing collects legacy 16, journeys 41, reset 24 and audit 702 cases,
plus a separate six-case production phase. Collection is not execution evidence.
The Developer MCP package receipt records 141 passed with zero skips.

The real local Developer MCP route proof now covers consent/PKCE, confirmation,
VM execution/destruction and one-use static preview. Production remains disabled
behind OWNER-DEVELOPER-MCP-02. GitHub Actions is billing-blocked, with no hosted
receipts for these waves; OWNER-KVM-CI-01 still requires actual runner proof.

V3 passes six frozen no-regression tests. Assessment still misses the LCP/CLS
product targets and the shared shell misses its initial-JS target. UAT-015 stays
open. Wave-7 UAT recorded 4 passing, 2 failing, and 24 blocked journey-width
checks. The wave-7 fixes have not been rerun through that matrix. The recorded
engineering score is 4.25. See the [UAT findings](../reviews/uat-2026-11-17/q1-findings-r1.md)
and [score assessment](../reviews/2026-11-17-ecs-wave7.md).
Earlier counts and timings below apply to their dated revisions.

## Historical wave 4b local evidence

Built-package validation covers 23 public packages. Registry contributions own
Brain dispatch and the browser fixtures' module entitlements; the module audit
has zero special cases. The browser suite passes nineteen journeys, including
Better Auth signup, invitation acceptance, sign-in/logout, MCP authorization
with PKCE and explicit mutation confirmation. Canonical database proofs execute
without skips. These are local synthetic proofs, not production-user evidence.

The unpublished `create-opentenant` package generates a minimal host from local
tarballs with typed configuration, a module composition, placeholder environment
settings and Postgres provisioning. Clean `node:22` container proofs take 40.463
seconds for local identity and 41.278 seconds for Better Auth. Both typecheck,
serve the synthetic tenant home with HTTP 200 and validate an authenticated
session. The complete application and production operations remain separate
from this minimal host. See [getting started](../adopters/getting-started.md).

Developer MCP remains disabled unless configured and rejects production
activation without OWNER-DEVELOPER-MCP-02 approval. Local Docker/KVM isolation
and SMTP composition now have real synthetic proofs. Public npm publication,
production sandbox use and production email delivery remain separate gates.

## Real local sandbox and email evidence, 2026-11-14

`pnpm sandbox:microvm-proof` passes the real microsandbox 0.7.13 local backend
against digest-pinned Alpine inside Node 22 Docker with KVM. Boot measured
0.447 seconds and the complete command 3.906 seconds. The proof checks denied
public/host egress, cleared environment, output and command deadlines, and
VM/process destruction. It needs no privileged container. Authenticated
microsandbox previews remain unsupported. See [provider evidence](../architecture/sandbox-providers.md).

`pnpm smtp:proof` passes four tests with no skips in 18.612 seconds against
pinned local Mailpit and disposable PostgreSQL. Support delivery, Better Auth
verification and invitation emails use the real notifications SMTP transport;
HTTP assertions cover recipients, subjects, rendered bodies and secret-free
headers. These are local synthetic results. Dedicated Ubuntu CI jobs have been
added but have not run on this branch; the owner must confirm runner KVM
support. See [email evidence](../runbooks/transactional-email.md).

## Round-3 local evidence

The shared identity contract covers local, Better Auth, WorkOS and Clerk.
Better Auth uses real disposable Postgres; the hosted gateways use synthetic
provider ports. Verification/invite mail uses `EmailTransport` and is disabled
unless configured. Real local SMTP evidence is recorded above; hosted identity remains unproved.

Neon and self-hosted Postgres provisioners share canonical tenant migrations,
restricted runtime roles and encrypted connection storage. Production requires
only the selected provider configuration. Postgres accepts `ap` as an operator
declaration, with no geographic placement service. Neon accepts `us` and `eu`.
The browser suite covers domain ownership verification and tenant CSS isolation
through real session validation. Tenant spans, persistent mutation limits and
uncached suspended-tenant API responses are implemented. OTLP/error export is
optional; no collector or error service was activated during integration.

## Status language

| Status | Meaning |
|---|---|
| **Implemented** | Code and automated behavioral coverage exist in the repository. |
| **Development-verified** | The real integration was exercised with synthetic data in an approved test-only environment. This is not production approval. |
| **Foundation only** | Contracts, policy, or test harnesses exist, but the end-user route or complete workflow is intentionally unavailable. |
| **Example** | Demonstrates how a module uses the platform. It can be replaced without changing OpenTenant's product boundary. |
| **Owner-gated** | Code alone cannot complete the work because a product, security, legal, account, or production decision is required. |

## The five ideas to understand first

1. **An installation is one OpenTenant deployment.** It owns one control plane
   and serves one or more tenants.
2. **A tenant is an isolated organization.** It has its own verified domains,
   membership, brand, enabled modules, and tenant data plane.
3. **Provider choice happens per installation.** A hosted deployment selects
   Better Auth, WorkOS or Clerk; it does not use one provider for some tenants and another
   provider for others.
4. **Modules use OpenTenant contracts.** They do not receive identity-provider
   objects, control-plane credentials, signing keys, or another tenant's data.
5. **Implemented is not the same as production-approved.** Production accounts,
   real data, public domains, retention, restore, incident response, and
   sandbox isolation remain separate gates.

## Capability map

### Tenant routing and lifecycle — implemented

OpenTenant resolves a request's validated host to exactly one active tenant
before identity, database, or module access. Caller-supplied trusted-context
headers are removed. Unknown, malformed, inactive, or contradictory tenant
context receives a generic failure without revealing tenant details.

Tenant creation queues durable Graphile Worker jobs and returns a job ID. The
worker resumes database checkpoints, issues a hashed 72-hour owner bootstrap
invite through the identity gateway, and activates last. Operator pages show job
status and audited retries. Owner elevation requires an authenticated,
email-matched, single-use claim. Reissue revokes the previous claim; ownership
transfer remains out of scope.

Installation owners can suspend/resume with audit evidence, request a local
filesystem export with an authorized 24-hour download, and soft-delete with a
scheduled hard erase. Suspended hosts render a suspended page; existing tenant
API gates return an uncached, secret-free 423 through the integrated shared
gates. Hard erase drops the
tenant database through the provisioner interface and removes control-plane
rows, retaining only a content-free installation audit receipt.

These paths are local synthetic implementations, not hosted operational proofs.
The export materializes tables in memory, and the web and worker require shared
private storage. Helpdesk projection now has a per-tenant scheduled caller.
See [the worker runbook](../runbooks/tenant-worker.md) for configuration,
identity reconciliation, retention, and erase privilege requirements.

**Human outcome:** a custom domain or request cannot silently drift into the
wrong organization's session or data.

### Identity, organizations, and members — implemented

The application uses one internal `IdentityGateway` contract. A deployment
selects:

- **Local** for single-user or explicitly configured multi-user development only;
- **Better Auth** for self-hosted email/password identity. The adapter includes
  organization roles and host-bound sessions. SSO and SCIM require explicit
  operator configuration; external IdP proof remains follow-up work. Optional
  verification/invitation mail is composed through `EmailTransport`. See the
  [adapter runbook](../architecture/better-auth-adapter.md);
- **WorkOS** for hosted identity and organization administration; or
- **Clerk** as a complete hosted alternative with native Next.js sessions and
  organization controls.

Both hosted adapters normalize users, organizations, memberships, roles, and
allowlisted permissions into stable OpenTenant records. Provider IDs remain in
provider-bound mappings. Unknown roles, malformed permissions, inactive
sessions, missing memberships, and mixed-tenant results fail closed.

WorkOS has a complete synthetic hosted login and cleanup proof. Clerk's adapter,
browser composition, and administration paths are implemented; the full
synthetic organization/member browser proof is owner-gated until the final
custom-role System Permissions are approved in the demo account.

**Human outcome:** adopters choose Better Auth, WorkOS or Clerk without rewriting tenant
authorization or leaking provider-specific identifiers into modules.

### Data planes and tenant isolation — implemented; Neon and local Postgres proofs

The control plane stores the tenant registry, domains, brand policy, module
catalog, identity mappings, encrypted connection records, provisioning state,
OAuth vault records, and audit evidence.

Tenant application data uses a tenant-specific PostgreSQL database or equivalent
isolated locator. Every shared tenant table enables and forces row-level
security. Application queries set the tenant ID inside a transaction through a
non-bypass role; a missing or wrong tenant context sees no rows and cannot
mutate them.

The canonical tenant migration catalog is ordered and checksum-tracked. It can
baseline an exact legacy schema, rejects malformed or ambiguous schemas, and
enforces one tenant identity anchor per database. Connection strings are
encrypted with AES-256-GCM and bound to tenant context.

Local PostgreSQL 17 and the real Neon provisioning path have both been
exercised. Operator-owned Postgres provisioning also has real-database,
restricted-role and cross-database login proofs. Production chooses Neon or
Postgres and requires only that provider configuration. Other PostgreSQL providers,
including a possible future Supabase adapter, would need their own provisioning,
connection, migration, isolation, and recovery implementation and evidence.

**Human outcome:** tenant data has explicit database and row-level boundaries,
with failures biased toward no access.

### Branding, navigation, and tenant administration — implemented

The shell resolves platform defaults, platform-owned tenant policy, tenant
overrides for unlocked fields, and module presentation into one immutable brand
snapshot. Brand input is typed; arbitrary CSS, scripts, and external asset hosts
are not accepted.

Tenant owners and delegated administrators can manage approved brand fields,
members, enabled modules, navigation, and connections within their tenant.
Platform administrators retain tenant lifecycle, locked policy, module catalog,
and global audit responsibilities.

**Human outcome:** one platform can feel tenant-specific without allowing a
tenant to alter platform policy or another tenant's experience.

### Custom domains — locally browser-tested; hosting proof pending

Tenant owners and administrators can add, verify through DNS TXT, and remove
custom subdomains with atomic audit evidence. Challenges are stored hashed;
only verified, unexpired domains resolve. Reverification is a pure callable
contract with no worker wiring yet. Sign-in and settings use the tenant's
platform subdomain with host-only sessions. Resolved per-tenant color and font
tokens render as validated root CSS variables.

The Vercel hosting adapter is dry-run only and disabled without configuration.
The shared Playwright suite verifies domain ownership and removal, per-tenant
themes and hostile persisted CSS through the real session path. Hosting
activation remains separately unverified.
See the [custom domain runbook](../runbooks/custom-domains.md).

### Tenant activity and launcher — implemented

Tenant owners and administrators can read a bounded recent-activity timeline
for the verified active tenant. Every record passes through a default-deny
action and metadata projection; raw audit detail, provider identifiers,
secrets, and caller-selected tenant filters are never rendered.

Signed-in users receive launch cards derived only from their active
memberships, active tenant records, and verified OpenTenant subdomains. Links
return through the normal host resolver, so headers, cookies, query strings,
and request-supplied tenant IDs cannot establish the active tenant.

**Human outcome:** users can find their organizations and administrators can
see recent safe operational context without creating a cross-tenant selector.

### Native and remote modules — implemented core and ownership boundaries

A versioned manifest describes a module's key, runtime, navigation, permissions,
settings, health, and compatible platform version. Entitlements decide which
modules a tenant has; mapped manifest roles cap permissions and session claims
further narrow elevated grants. Legacy unmapped manifests retain their previous
claim-based policy.

Module identities now have one closed ownership scope: platform,
installation-owner, or tenant private. Tenant-created modules are private by
construction and cannot be assigned to another tenant. Installation-owned
modules stay inside the control plane's generated installation identity.
Entitlements select an explicit immutable artifact version.

Reviewed promotion is an insert-only server composition boundary: it requires
installation publication authority, binds review evidence to the exact private
source digest, and creates a new installation-owned identity, version, and
digest with creator, reviewer, publisher, source, and atomic audit provenance.
It never changes the private source. The persistence and policy contracts are
implemented; a user-facing promotion route and deployment/publication workflow
are not.

Native modules are trusted packages compiled into the platform. Remote modules
run outside the platform process and receive a short-lived Ed25519-signed
context bound to one tenant, user, module, permission set, brand snapshot, and
expiry. The remote module receives the verification key, never the signing key.

Remote composition and signed context are implemented. A complete marketplace,
automatic deployment/publication path, and user-facing tenant module lifecycle
are not.

Remote delivery is disabled until an operator configures exact trusted
deployment hostnames in `MODULE_REMOTE_HOST_ALLOWLIST`. Only standard HTTPS DNS
destinations are accepted. The proxy keeps decoded paths on the approved origin,
does not follow redirects, and forwards no platform cookie, authorization, or
arbitrary inbound headers with the signed context.

**Human outcome:** product features can be modular without turning every module
into a privileged extension of the control plane.

### Brokered module data — first capability implemented

Modules receive no tenant data by default. The first brokered capability,
`support.ticket.read`, is useful but intentionally narrow: an identity-backed
remote module can receive up to 25 ticket-number, category, status, priority,
and update-time summaries. It cannot receive ticket subjects, descriptions,
internal identifiers, people, messages, events, database connection strings,
provider credentials, or a caller-selected query.

Access requires every boundary to agree: the immutable module version requested
the capability, its creator was allowed to delegate it, the tenant granted that
exact version, the entitlement is active, and the signed runtime user has the
module-bound permission. Missing, expired, revoked, stale-version, unknown, or
cross-tenant authority fails closed before the tenant operation runs. Grant,
use, denial, error, and revocation evidence is content-free and hash-chained.

There is no grant-management UI, service grant, broad database capability, or
Developer MCP exposure yet. Those are separate reviewed slices rather than an
implicit widening of this broker.

**Human outcome:** a remote feature can use a specific piece of tenant data
without becoming a database administrator or receiving ambient credentials.

### Audit, credentials, and observability — implemented

Privileged events append to tenant- or scope-bound hash chains. Where a
business mutation and its evidence must agree, they commit together.
Verification labels history honestly as canonical, legacy-but-valid, empty, or
unverified; it never rewrites old events to make them appear stronger.

Provider credentials are encrypted at rest, bound to tenant/provider context,
and redacted from errors. Telemetry accepts content-free allowlisted events and
rejects arbitrary prompts, answers, tokens, or database values. The server now
logs only fixed event/outcome names, bounded numeric operational fields and the
active trace ID. OTLP tracing and Sentry-protocol server error capture are
opt-in; both discard tenant content, secrets and request metadata. Generic
error screens do not render the original exception. Tenant resolution emits a
`tenant.resolve` span without changing lookup semantics. See the [SLO runbook](../runbooks/slo.md)
for configuration, proposed objectives and the current coverage boundary.

**Human outcome:** operators can tell who changed privileged state and detect
broken evidence without exposing tenant content or credentials.

Persistent PostgreSQL rate limits also cover settings, member, identity-portal,
brand-proposal and support mutations, plus passcode verification and the module
proxy. The limiter uses a separate one-connection pool and returns 429 with
`Retry-After`. Tenant creation and lifecycle mutations use the verified
installation owner and a shared installation-scoped budget. Suspended-tenant
API gates return an uncached, secret-free 423.

### Admission control and exact usage evidence — implemented

Assessment readout, telemetry, and module-access routes use one shared
PostgreSQL admission store rather than per-process counters. Fixed windows,
concurrent leases, idempotency replay, size bounds, policy snapshots, expiry,
and release behavior are transactional and scoped by trusted tenant,
principal, operation, and server-owned route identifiers. Replays are
non-executable, malformed caller keys remain input errors, passcode evidence is
server-keyed, and provider streaming is cancelled at the persisted lease
deadline.

The separate exact-usage ledger accepts only trusted server-registered metric
definitions. Tenant-scoped events have positive safe-integer quantities,
distinct occurrence and recording times, bounded source/fingerprint evidence,
and explicit idempotency keys. PostgreSQL rejects update, delete, and truncate;
replay requires the complete immutable event identity, corrections append linked
signed deltas with reasons at the original occurrence timestamp, and aggregation
uses a bounded half-open tenant/metric window.

Optional [usage export](../architecture/usage-export.md) sends minimal CloudEvents
to an OpenMeter v1-compatible ingest endpoint or private local JSON files. A
durable per-sink cursor and receipts preserve retries and late commits without
changing ledger evidence. Tests use PostgreSQL and mocked HTTP ingestion; no
hosted metering or billing is enabled.

Admission does not create usage automatically, and exact usage is not a price,
plan, entitlement, invoice, or payment-provider decision. Those commercial
semantics remain owner-gated.

**Human outcome:** one application process cannot silently bypass shared limits,
and future commercial policy can consume exact evidence without redefining
authorization or rewriting history.

### Brain knowledge MCP — implemented locally

Brain search, decision reads, brand markdown and signal promotion execute against
the tenant's forced-RLS PostgreSQL schema. Search uses pgvector and resolves the
tenant-approved model route before creating embeddings. A deterministic local
adapter supports development and tests; it is token hashing, not a semantic
hosted model. No hosted embedding provider is active by default. Promotion writes
validated context and its decision-chain entry in one transaction. The route
requires signed module context, a matching live session and current entitlement.
Real PostgreSQL proofs cover cross-tenant denial and audit rollback. This does
not establish a production knowledge-ingestion or hosted-model service.

The `/brain` browser route exists. Its current host renders an explicit
unavailable state because browser authority minting and an approved browser
embedding route are not composed. It exposes no search control. The separate
signed `/api/mcp/brain` API is not authorized by a browser cookie alone. The
[wave-5 browser receipt](../adopters/wave5-wiring-verification.md) covers this
boundary; the presence of a page is not proof of working browser retrieval.
OpenAI-compatible embedding adapters and optional host configuration exist,
with synthetic HTTP coverage only and no live provider validation.

### Developer MCP and isolated module development — implemented, disabled pending owner approval

The Developer MCP is the planned tenant-developer surface for creating remote
modules with an AI coding client or other MCP client. It is separate from the
knowledge module's retrieval MCP and from Vercel's operator MCP.

Implemented foundations include:

- provider-neutral token verification and active tenant binding;
- an exact WorkOS JWT verifier for the current authentication prerequisite;
- frozen permission profiles and tool/resource schema vocabulary;
- stateless modern MCP `2026-07-28` validation, server discovery, and private
  authority-filtered tool listing;
- per-call live authorization with bounded authority freshness and resource
  checks;
- atomic append-only decision audit with staged validated context;
- fail-closed sandbox path, command, resource, network, and preview policy;
- in-memory conformance and orchestration tests;
- sandboxd feasibility and an injected Vercel Sandbox boundary;
- optional E2B and local microsandbox SDK adapters with shared mock conformance;
  microsandbox previews are unsupported; its real Docker/KVM lifecycle and
  isolation proof passes locally;
- immutable, digest-verified server-owned templates;
- an Apache-licensed Next.js/Tailwind v4 tenant-module source starter with
  semantic brand tokens and official shadcn/ui configuration;
- bounded install, build, test, preview, evidence, and teardown orchestration;
  and
- secret-safe provider errors and authenticated preview mediation.

The local `/api/mcp/developer` route implements modern discovery, protected-resource
metadata, denial-first opaque-token authentication and tenant-scoped call
authorization. A single `workspace.create` tool writes an approved synthetic
service template into a local sandbox and returns a one-time static preview after
teardown. PostgreSQL tests exercise audit, expiry, cross-tenant denial, admission,
confirmation and independent kill switches with a local stub sandbox.

It is **implemented, disabled pending owner approval**, not live. The default
server flag is off. Production rejects enablement without the exact approved
route under OWNER-DEVELOPER-MCP-02. Canonical migrations, global startup validation, exact-count CI, local/Better
Auth PKCE authorization and authenticated browser confirmation are integrated.
The [real local route receipt](../reviews/2026-11-17-developer-mcp-route.json)
now proves OAuth/PKCE, explicit human confirmation, VM execution/destruction,
credential absence, denied egress and a one-use static preview through the actual
route. The earlier provider lifecycle proof is separate evidence. Hosted CI,
approved production sandbox operation and the owner decision remain gates. The
[Developer MCP runbook](../runbooks/developer-mcp.md) lists these limits and the
owned exported helpers. No hosted sandbox or deployed configuration was enabled.

The checked-in UI starter can be copied and built directly today. Its exposure
through a tenant-authorized scaffold tool and its server registry identifier
remain part of the gated Developer MCP launch. Licensed Shadcn Studio material
is explicitly excluded from that builder surface and lives only in a separate
OpenTenant marketing end product.

**Human outcome:** the dangerous execution boundary is designed and tested
before a coding agent receives authority to create or publish tenant modules.

### Example modules — examples

- **Assessment** demonstrates branded native UI, deterministic scoring,
  browser-local state, exports, and optional streamed model readouts.
- **Knowledge** has the `/brain` unavailable-state UI and a separate signed
  knowledge API. Library retrieval and promotion do not imply composed browser
  tools or hosted semantic search.
- **Support** demonstrates tenant-local numbering, projection-backed owner
  queues with canonical detail reauthorization, distinct requester and
  tenant-staff workflows, accessible status/assignment/priority/history and
  content-free delivery-failure visibility, provider-neutral in-app/email
  recovery contracts with a Nodemailer SMTP adapter and React Email templates,
  bounded attachment metadata, deterministic SLA state,
  requester-owned CSAT, content-free tenant analytics, triage, public/internal
  note separation, and transactional audit. `/support` and `/support/:id` are
  composed ticket pages, not library-only examples. Persistent AI suggestions
  and human review have a local browser proof. Requesting or reviewing a
  suggestion cannot send a reply or mutate the ticket; sending uses the normal
  explicit human reply action. Routed generation and rejected-output quarantine
  remain disabled pending their provenance and quarantine dependencies. See
  [host limits](../adopters/wave5-ai-wiring.md).

These modules are synthetic reference implementations. OpenTenant is not an
assessment product, knowledge product, or support product.

## Provider choices and extension points

| Area | Shipped choice | What can change later |
|---|---|---|
| Identity | Local for development; Better Auth for self-hosted email/password; WorkOS or Clerk for hosted installations | Another provider can implement the normalized session, organization, membership, and administration contracts. |
| Database | Development PostgreSQL, operator-owned per-tenant PostgreSQL, or Neon | Another PostgreSQL provider can implement provisioning and recovery behind the locator/migration boundary. Supabase is not yet implemented. |
| Hosting | Standalone container and Compose with Postgres 17; Vercel REST preview helper; optional Kamal example | Local deployment smoke covers migration, liveness and host denial. Vercel and Kamal remain owner-gated and have no hosted verification. Account, team, project, region and domain stay runtime configuration. |
| Sandbox | In-memory tests, sandboxd/Vercel boundaries, optional E2B and local microsandbox SDK adapters | Shared mock conformance plus a passing local Docker/KVM isolation proof for microsandbox; hosted isolation remains unproved. See [provider limits](../architecture/sandbox-providers.md). |
| Model readout | Optional OpenAI-compatible and Anthropic-compatible chat plus OpenAI-compatible embeddings, behind tenant-policy ports | Wave-5 R5 adapters and typed host composition have synthetic HTTP coverage only. No live model-provider validation is recorded; unconfigured production has no local fallback. Vercel AI Gateway has no separate proven adapter. See [configuration](../adopters/wave5-ai-wiring.md). |

Provider-neutral does not mean every provider works today. It means the current
implementation keeps the application contract smaller than any one provider,
so alternatives can be added deliberately and tested against the same security
and behavior requirements.

## Two MCP surfaces that should not be confused

| Surface | User | Purpose | Current state |
|---|---|---|---|
| **OpenTenant Developer MCP** | Tenant developer or delegated coding agent | Build and eventually publish tenant-private remote modules | Implemented locally; disabled pending owner approval |
| **Vercel operator MCP** | Human platform operator | Inspect deployments, bounded logs, approved previews, and feedback | Optional runbook; every call requires confirmation |

Vercel MCP does not receive tenant authority, run generated code, replace the
Developer MCP, or authorize unattended provider changes.

## What is not production-ready

The following remain owner-gated or externally controlled:

- production identity settings, abuse controls, domains, and OAuth callbacks;
- production data region, retention, point-in-time restore, backup export,
  incident response, deletion evidence, and cross-tenant restore exercises;
- Vercel Sandbox isolation, egress, preview authentication, cost, region,
  retention, and deletion approval;
- production activation of the locally proven Developer MCP route and its
  route-specific launch, sandbox, preview, confirmation and kill-switch approval;
- commercial billing metrics, correction/replay policy, plan semantics, and a
  payment-provider boundary;
- the development Slack probe and the organisational SOC 2/Vanta boundary;
- legal steward, rights attestation, artifact-specific notices, trademark and
  security-disclosure review, qualified counsel review, and public release; and
- any use of genuine tenant or customer data.

See [owner tasks](../OWNER-TASKS.md) for the exact decisions and the work that
can resume after each one.

## Evidence and deeper reading

- [Accepted architecture](../architecture/platform-architecture.md)
- [Current handoff and verification](../HANDOFF.md)
- [Detailed ship log](../SHIPLOG.md)
- [Developer MCP product requirements](developer-mcp.md)
- [Developer MCP threat model](../security/developer-mcp-threat-model.md)
- [Hosted preview runbook](../runbooks/deploy-preview.md)
- [Vercel operator MCP runbook](../runbooks/vercel-operator-mcp.md)
- [Technical licence and provenance review](../legal/2026-07-20-technical-licence-provenance-review.md)

Server credential encryption supports a keyring with an active key ID and
legacy reads. An operator can rotate database connection, OAuth vault and
model-provider credentials in audited, resumable batches. See the
[rotation procedure](../runbooks/encryption-key-rotation.md). Support has a
PostgreSQL delivery store and worker path, with eight non-skipping delivery
cases in the [V1 database receipt](../../tooling/ci/db-sequence-inventory.md).
The [wave-5 browser receipt](../adopters/wave5-wiring-verification.md) includes
durable email and suggestion review. In-memory helpers remain library test
implementations; they do not describe the complete host. No production email
service is established by these local proofs.

## Authorization adapters

The default in-process authorization port intersects live module entitlement,
manifest role maps and declared permissions. IdP claims narrow elevated grants.
Built-in modules use maps; third-party manifests without them retain an explicit
legacy claim-passthrough exception. An optional Apache-2.0 OpenFGA adapter adds
tenant-bound relationship checks, with a shared conformance suite and real local
container tests. Membership and entitlement sync helpers are exported; lifecycle
wiring and production enablement remain integration work. See
[authorization architecture](../architecture/authorization.md).
