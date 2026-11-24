# Product requirements: Tenant Module Developer MCP

Status: local route implemented, disabled pending OWNER-DEVELOPER-MCP-02 approval.
See [the current runbook](../runbooks/developer-mcp.md) for implemented tools,
integrated local flow and remaining production proof limits. The broader
requirements below remain the product design, not a live capability claim.

Date: 2026-07-19

Owner: OpenTenant platform

Workstream: current priority; WP-D.2 remains deferred

## 1. Executive summary

The Tenant Module Developer MCP gives authorised tenant developers and
non-technical tenant administrators a safe, agent-friendly way to create
completely new OpenTenant modules without routine OpenTenant engineering involvement.
It exposes a dedicated MCP server for platform discovery, module scaffolding,
isolated code generation and testing, live preview, validation, publication
approval, and tenant-private module registration.

Tenant-created code is always a remote module. It executes outside the OpenTenant
platform process and integrates through the existing module manifest, tenant
entitlement, path-composition, and short-lived signed-context contracts. The
developer MCP is separate from the Brain MCP: the Brain MCP retrieves and
promotes tenant knowledge, while the Developer MCP creates and manages module
artifacts.

The product supports group-assigned capability profiles rather than a single
global limited/full flag. Elevated users may invoke more powerful,
tenant-scoped operations, but generated code never receives raw production
database credentials, provider secrets, control-plane access, or unrestricted
infrastructure tokens. Data, credential, and infrastructure operations are
brokered, policy-checked, attributable, revocable, and audited.

WorkOS supplies the selected hosted identity and authorization building blocks:
AuthKit/Connect for standards-compatible MCP OAuth, RBAC for tenant-wide
developer eligibility, and FGA for access to individual workspaces, modules,
versions, and publication actions. OpenTenant remains the policy-enforcement and
audit authority presented to modules; modules never call WorkOS directly.

## 2. Problem statement

Today, 100% of net-new OpenTenant modules require OpenTenant engineering involvement.
The platform has the runtime contracts for native and remote modules, but no
tenant-facing authoring lifecycle. A builder must independently understand the
module SDK, create a repository, produce a valid manifest, implement signed
context handling, configure a deployment, test tenant isolation, register the
module, and arrange entitlement. Those boundaries make self-service module
creation impractical even when an AI coding agent can generate the application
code.

### Tenant developer pain

- There is no machine-readable development surface that describes the
  tenant's available platform contracts and capabilities.
- Preview, validation, registration, and publication are disconnected manual
  activities.
- A developer cannot safely exercise tenant services without being given
  credentials or bespoke platform support.

### Non-technical tenant administrator pain

- An administrator can describe a workflow to an AI coding agent but cannot
  safely let that agent execute generated code against the tenant.
- The user lacks a trustworthy preview-to-publish path with understandable
  approvals and rollback.
- A binary “agent has access” model would expose more data and infrastructure
  than the task requires.

### Platform operator pain

- Ad hoc module onboarding creates inconsistent security reviews, manifests,
  deployment controls, and audit evidence.
- Untrusted or AI-generated code risks credential exfiltration, cross-tenant
  access, resource abuse, and unstable production releases.
- There is no central kill switch or inventory for tenant-authored modules.

The initial baseline is therefore zero self-service module creation. Phase 1
will instrument time-to-preview, intervention rate, validation failures, and
publication outcomes rather than inventing historical performance data.

## 3. Goals and success metrics

| Priority | Goal | Initial success measure |
|---|---|---|
| P0 | Safe self-service creation | Two pilot users—one developer and one non-technical administrator using an AI coding agent—each create a new module and reach a working preview without OpenTenant editing the module code. |
| P0 | Strong tenant isolation | Zero cross-tenant data, identity, deployment, or module-entitlement access in automated isolation tests and pilot telemetry. |
| P0 | Attributable operations | 100% of MCP tool calls, capability decisions, preview actions, and publication actions carry tenant, actor, MCP client, workspace, and correlation identifiers in the audit trail. |
| P0 | Controlled publication | 100% of production publications pass automated gates and receive an explicit `module.dev.publish` approval; no coding agent can silently self-promote. |
| P0 | Secret containment | Zero raw platform, database, provider, or infrastructure credentials exposed to the MCP client, model context, module workspace, sandbox environment, logs, or generated artifacts. |
| P1 | Useful speed | Median prompt-to-running-preview under 60 minutes during the pilot, with platform-caused failures excluded and reported separately. |
| P1 | Low operator dependency | At least 80% of pilot build-and-preview sessions complete without OpenTenant engineering intervention. |
| P1 | Recoverability | Disable or roll back a published tenant module within 10 minutes without deleting its source or tenant data. |
| P1 | Reliable validation | At least 95% of modules that pass the publish gate deploy successfully; every failed gate returns an actionable, non-secret-bearing error. |
| P2 | Reuse | At least 50% of pilot modules start from an approved template or reusable module capability. |

## 4. Non-goals

- Tenant-authored native modules compiled into the platform application.
- Direct access to the control-plane database or another tenant's resources.
- Raw database connection strings, OAuth tokens, cloud keys, signing keys, or
  deployment credentials in an agent or sandbox.
- An unrestricted shell on OpenTenant production infrastructure.
- Automatic production publication based only on an agent's judgment.
- A public module marketplace, cross-tenant module sharing, billing, or
  commercial licensing in the first release.
- Editing OpenTenant-owned native modules through this MCP.
- Replacing the Brain MCP, platform admin UI, Git provider, CI system, or
  module runtime.
- Allowing generated modules to invent permissions or platform APIs that are
  not registered and approved.
- Redistributing Shadcn Studio or other licensed builder resources through
  tenant workspaces; the default module UI surface uses the official shadcn/ui
  registry and independently reviewed OpenTenant material only.

## 5. User personas

### Persona A: Tenant developer

A software developer employed by the tenant. They connect an IDE or coding
agent to the Developer MCP, inspect platform contracts, scaffold a module,
write and test code, preview it with synthetic or approved tenant data, and
submit a version for publication. They value source ownership, logs,
repeatability, and precise errors.

### Persona B: AI-assisted tenant administrator

A non-technical administrator who can describe a business workflow but does
not write code directly. They use an approved AI coding agent and templates,
review a live preview, understand requested capabilities in plain language,
and submit the module for approval. Their default capability profile cannot
read genuine tenant data or publish directly.

### Persona C: Tenant module publisher

A tenant owner, administrator, or delegated release manager with
`module.dev.publish`. They review the manifest, permissions, data operations,
egress, validation evidence, and preview before approving a production
version. A publisher can revoke a release or capability but cannot retrieve
raw secrets.

## 6. Product principles and architecture

### 6.1 Separate Developer MCP

The planned platform surface uses a dedicated remote MCP endpoint, provisionally
`/api/mcp/developer`. It has its own OAuth audience, tools, permissions,
consent records, rate limits, and audit namespace. It may read approved Brain
resources for grounding only when the caller separately has `brain.use` and
explicitly consents; Brain access is not implied by module-development access.

The first route targets the stable MCP `2026-07-28` protocol and is modern-only:
no `initialize` handshake, protocol session, `Mcp-Session-Id`, HTTP+SSE fallback,
Roots, Sampling, or Logging surface. Every request is independently authorized;
request `_meta` describes protocol capability but never establishes the client
principal used for consent or audit. See
[ADR-006](../architecture/adr-006-developer-mcp-protocol-baseline.md).

The official specification and release sources reviewed on 2026-08-06 list
`2026-07-28` as the current stable protocol revision. The shipped contract
matches that revision's stateless per-request negotiation,
`server/discover`, deterministic `tools/list`, required `resultType`, explicit
cache scope/TTL, and structured error surface. Its authorization plan also uses
Protected Resource Metadata, exact issuer/resource validation, and Client ID
Metadata Documents while leaving deprecated Dynamic Client Registration off by
default. New optional extensions such as Skills over MCP, MCP Apps, or broader
task workflows do not change the first-route security boundary and require
separate reviewed product work.
[MCP `2026-07-28` changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
and [MCP releases](https://github.com/modelcontextprotocol/modelcontextprotocol/releases).

WorkOS AuthKit/Connect is the selected hosted authorization server. The Developer
MCP publishes OAuth Protected Resource Metadata, registers its endpoint as a
WorkOS Resource Indicator, and validates WorkOS JWT issuer, signature,
expiration, `aud`, `org_id`, subject, and scopes. WorkOS then owns the OAuth
authorization, refresh, introspection, consent, and client-discovery surface;
OpenTenant owns tenant resolution, capability policy, resource authorization, and
tool execution. Client ID Metadata Document support is preferred, with Dynamic
Client Registration disabled for the first route and considered later only as
a measured compatibility fallback for older MCP clients.
[WorkOS MCP authorization](https://workos.com/docs/authkit/mcp)

The MCP server must validate that access tokens were issued specifically for
it and must not pass an inbound token through to downstream services. These
are explicit requirements in the current MCP authorization guidance and avoid
confused-deputy failures. Third-party connections require per-client,
per-user consent that identifies the MCP client and requested scopes.
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).

#### AI agent identity

WorkOS Agent Registration is the preferred future path for AI coding agents
if enabled for the OpenTenant environment. Only `service_auth` is permitted: the
agent must complete the human claim ceremony, and the resulting short-lived
token must contain the tenant `org_id`, requested scopes, and an `act` claim
identifying the delegating user. Anonymous agent registration and durable
agent API keys are disabled for the initial release. High-risk calls perform
synchronous revocation validation in addition to local JWT verification.

Agent Registration is not a hard launch dependency because WorkOS currently
requires it to be enabled for an environment. Standards-compatible AuthKit MCP
OAuth remains the baseline, and CLI Auth may support a future OpenTenant developer
CLI through the device authorization flow.
[WorkOS Agent Registration](https://workos.com/docs/authkit/agent-auth) and
[WorkOS CLI Auth](https://workos.com/docs/authkit/cli-auth)

### 6.2 Remote-only tenant modules

Tenant-authored modules use the accepted remote-module architecture:

1. A versioned `ModuleManifest` declares routes, navigation, permissions,
   settings, health, and required capabilities.
2. A tenant-private registry record owns the module and its versions.
3. The platform composes the deployed module under the tenant domain.
4. The platform makes the access decision and hands the module a short-lived,
   module-bound signed context.
5. The module uses narrow platform APIs and never queries the control plane or
   identity provider directly.

Existing platform modules and tenant-authored modules share the manifest
contract but not the trust level or execution boundary.

### 6.3 Isolated build and preview

Every generated workspace, dependency install, build, test, and development
server runs in an ephemeral isolated sandbox. The OpenTenant control plane
owns identity, policy, module state, audit, and publication; a provider-neutral
`SandboxAdapter` owns only workspace execution. Its minimum contract covers
create, write files, execute a bounded command, expose an authenticated
preview, checkpoint, restore, collect logs and artifacts, and terminate.

The first implementation milestone evaluates two adapters against the same
conformance suite:

- **sandboxd** for local and self-hosted development because it already offers
  an API-first sandbox lifecycle, live preview routing, checkpoints, Git
  operations, and credential injection outside the workspace. It remains an
  adapter candidate—not the OpenTenant control plane—because its current beta
  is container-based, single-server, and requires additional authentication
  and multi-tenant hardening.
- **Vercel Sandbox** for a hosted pilot because it is designed for untrusted
  and AI-generated code, provides isolated microVMs and live previews, and
  supports network policy and brokered credentials. Its documentation
  recommends keeping production systems and credentials outside the sandbox.

OpenFlow is not a base repository or runtime dependency. Its tenant cost
attribution, execution-event vocabulary, workflow composition, and MCP
connection-lifecycle ideas may inform independently implemented OpenTenant
contracts. No OpenFlow code is copied unless a separate provenance, licence,
security, and dependency review approves an exact pinned revision. The current
repository is an agent/workflow builder on Supabase and is mid-runtime
migration, which does not match the module-code sandbox boundary.

The adapter contract—not a provider—is the product boundary. Vercel Sandbox is
the selected hosted target; every adapter must support ephemeral filesystems,
resource/time limits, deny-by-default egress, controlled preview exposure, log
collection, deterministic teardown, and evidence needed by the OpenTenant
audit chain. The provider selection does not authorise a paid plan, live
resource, or production enablement.

[sandboxd repository](https://github.com/tastyeffectco/sandboxd),
[Vercel Sandbox documentation](https://vercel.com/docs/sandbox), and
[OpenFlow repository](https://github.com/daviddominguezh/llm-graph-builder)

### 6.4 Capability profiles, not raw access

WorkOS RBAC permissions select organisation-wide eligibility for the Developer
MCP and its broad capability profile. WorkOS FGA supplies resource-specific
checks for an individual module project, workspace, version, preview, or
publication action. Permissions—not role names—are evaluated for every MCP
tool call; authority is not copied into a long-lived agent credential.

| Profile | Intended user | Allowed capabilities |
|---|---|---|
| Builder | Default developer or AI-assisted admin | Platform docs and templates, tenant-safe metadata, workspace editing, dependency install through policy, tests, synthetic-data preview. |
| Trusted builder | Delegated tenant group | Builder capabilities plus approved read-only data views, selected tenant API actions, and approved outbound services through brokers. |
| Module publisher | Tenant release group | Review evidence, approve/reject a version, deploy, disable, and roll back tenant-owned modules. |
| Capability administrator | Tenant owner or delegated security admin | Assign tenant-scoped profiles, approve capability requests, set quotas and egress policy, revoke sessions and modules. |

There is intentionally no profile that exposes raw credentials or
unrestricted platform infrastructure. “Full” means the complete set of
approved tenant-scoped brokered capabilities, not bypassing the platform's
security boundaries.

The initial FGA hierarchy is `module_project` → `module_workspace` and
`module_version`, with preview and deployment operations authorised against
their owning version. Platform-defined resource types and permission slugs are
fixed during Phase 0 because WorkOS treats them as immutable contracts.
Organisation-level RBAC grants baseline access; direct or inherited FGA role
assignments grant narrower authority on specific module projects. The OpenTenant
control plane remains authoritative for module lifecycle state and records the
WorkOS decision identifiers used for evidence.

Enterprise tenants may map identity-provider groups to platform-defined
developer roles through Directory Sync and Admin Portal. The UI must show when
an IdP mapping controls a role because IdP assignments take precedence over a
manual API assignment. Tenant-defined custom roles are deferred until a safe
permission-migration policy exists.
[WorkOS RBAC](https://workos.com/docs/rbac),
[WorkOS FGA](https://workos.com/docs/fga/roles-and-permissions), and
[Directory group role assignment](https://workos.com/docs/directory-sync/identity-provider-role-assignment)

### 6.5 Brokered privileged operations

- **Database:** modules receive a module-specific API or database role scoped
  to their own tenant schema and declared operations. Schema changes are
  migration plans reviewed and applied by the platform. Direct control-plane
  access is impossible.
- **Credentials:** secrets remain in the encrypted vault or deployment
  provider. A request proxy injects a credential only into an approved
  outbound call; the sandbox and module never receive the secret value.
- **Infrastructure:** a module submits a declarative resource plan. The
  platform validates tenant ownership, allowlisted resource types, region,
  quota, and cost; an authorised human approves application. No general cloud
  token or Terraform shell is exposed.
- **Network:** sandbox and module egress is deny-by-default and expanded only
  through manifest-declared, policy-approved destinations.

Vercel's current sandbox pattern supports credential injection at the network
boundary so authenticated calls can be made without placing tokens inside the
sandbox. [Vercel credential brokering](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox)

### 6.6 WorkOS rollout, revocation, and customer evidence

- **Feature Flags:** target the Developer MCP pilot and individual high-risk
  capabilities to selected users or organisations. Flags control rollout only;
  they never grant authorization, and a user must still pass RBAC/FGA checks.
- **Events:** consume one idempotent WorkOS event stream for agent registration,
  membership, group, role, permission, and session changes. Relevant changes
  invalidate local authorization caches, sessions, and broker grants.
- **Audit Logs:** the existing OpenTenant hash chain remains the transactional
  source of truth. An outbox may replicate a curated, non-sensitive subset to
  WorkOS Audit Logs so enterprise tenants can export or stream familiar
  compliance evidence. A WorkOS outage must not remove or rewrite canonical
  OpenTenant evidence.

[WorkOS Feature Flags](https://workos.com/docs/feature-flags),
[WorkOS Events](https://workos.com/docs/events), and
[WorkOS Audit Logs](https://workos.com/docs/audit-logs)

### 6.7 WorkOS managed-service evaluations

- **Pipes:** evaluate for new module-owned third-party OAuth connections because
  it manages authorization, refresh, and credential storage. It does not
  replace the shipped Google/Slack connector vault in WP-D.1 without a separate
  migration decision. Any token obtained by the platform stays inside the
  request broker and is never returned to the agent or module.
- **Vault:** retain the existing AAD-bound CredentialCipher vault for the first
  release. Evaluate WorkOS Vault later for organisation-isolated module secrets
  or customer-managed keys. Vault storage alone does not replace the egress
  broker or its destination and method policies.

Adopting Pipes or Vault depends on provider coverage, region, retention, cost,
and migration analysis and requires separate owner approval.
[WorkOS Pipes](https://workos.com/docs/pipes) and
[WorkOS Vault](https://workos.com/docs/vault/quick-start)

## 7. Functional requirements

### FR-001: MCP authentication and tenant binding

The Developer MCP must authenticate human users and approved agent clients,
bind every session to exactly one WorkOS organisation and internal tenant,
validate token audience and expiry, and reject anonymous or passcode-only
sessions.

Acceptance criteria:

- A valid user can connect only to a tenant where they have an active
  membership.
- Tokens minted for the Brain MCP, another API, or another tenant are rejected.
- The MCP publishes correct protected-resource metadata and challenges
  unauthenticated clients with the discoverable WorkOS authorization server.
- AI-agent access is user-bound through standard OAuth or a successful
  `service_auth` claim ceremony; anonymous agent identities are rejected.
- High-risk tools synchronously validate revocation state before execution.
- Revoking membership, client consent, or the MCP session removes access
  within the documented revocation window.
- The MCP never forwards the caller's token to another service.

### FR-002: Permission and capability resolution

Tenant owners can assign organisation-wide developer profiles through WorkOS
RBAC and approved IdP group mappings. WorkOS FGA assignments control access to
specific module resources. Every tool declares a required permission, resource
type, and risk class. The server resolves the caller's current permission on
each call and fails closed.

Acceptance criteria:

- Default builders cannot read genuine tenant data, use credentials, alter
  infrastructure, or publish.
- A profile change affects subsequent calls without reissuing a durable agent
  secret.
- Resource-specific operations check FGA using the caller's organisation
  membership and the OpenTenant external resource ID.
- Feature flags can hide or disable a capability during rollout but can never
  satisfy an authorization check.
- The platform identifies IdP-controlled assignments and does not promise that
  a conflicting manual role assignment will persist.
- Tool discovery returns only tools and capability descriptions the caller may
  know about.
- Cross-tenant and prefix-confusion permission tests pass.

### FR-003: Tenant-private workspace lifecycle

Users can create, resume, snapshot, export, and archive a tenant-bound module
workspace from an approved template.

Acceptance criteria:

- Stable workspace and module IDs are globally unique and tenant-bound.
- Templates pin compatible SDK, runtime, lint, test, and manifest versions.
- The initial Next.js UI starter pins Tailwind v4, semantic tenant-brand
  tokens, and the official shadcn/ui namespace; Studio/private registries are
  absent from the distributable baseline.
- Resuming a workspace cannot attach it to a different tenant or actor.
- Archiving preserves source and evidence but stops compute and preview access.

### FR-004: Agent-readable platform resources

The MCP exposes versioned resources for the module SDK, design tokens,
manifest schema, permitted platform APIs, examples, validation rules, and the
caller's effective capabilities.

The checked-in `templates/tenant-module-nextjs` source establishes the first
shadcn-ready UI profile. It is independently usable but does not become a
caller-selectable server template until its immutable registry identifier and
version are approved at the Developer MCP boundary.

Acceptance criteria:

- Resources identify their platform and schema versions.
- Examples contain synthetic data and no secrets.
- Stale SDK or manifest versions produce an upgrade path rather than a silent
  build failure.

### FR-005: Isolated code execution

All generated or tenant-supplied code runs in a new or resumed isolated
sandbox with explicit resource, duration, filesystem, and network policy.

Acceptance criteria:

- The sandbox has no inherited platform or deployment environment variables.
- Production database, metadata endpoints, internal control-plane hosts, and
  unapproved internet destinations are unreachable.
- CPU, memory, duration, concurrency, and spend limits terminate abusive work.
- Sandbox termination revokes preview access and broker sessions.

### FR-006: Safe dependency and supply-chain handling

Dependency installation follows tenant policy and produces reviewable
evidence.

Acceptance criteria:

- Lockfiles are mandatory and immutable during publication validation.
- Denied packages, install scripts, licences, vulnerabilities, or registries
  return actionable failures.
- Registry origins are explicit and versioned. A caller-supplied registry URL,
  response body, digest, `components.json`, or credential cannot make content
  approved.
- The publish artifact records a dependency inventory, integrity digest, and
  validation results.

### FR-007: Brokered tenant data access

Authorised workspaces can request declared data capabilities through typed
platform APIs. Synthetic data is the default; genuine data requires a profile
grant and an explicit session-level approval.

Acceptance criteria:

- Read and write capabilities are separate and independently revocable.
- Queries are tenant-bound, module-bound, rate-limited, and audited.
- Sensitive fields are masked or omitted unless explicitly declared and
  approved.
- The sandbox never receives a reusable database connection string.

### FR-008: Brokered credentials and external APIs

Modules can call approved third-party services through a platform proxy that
holds the credential and enforces destination, method, scope, rate, and audit
policy.

Acceptance criteria:

- Secret values never appear in tool results, sandbox memory, logs, or module
  artifacts.
- A module cannot redirect or replay a brokered request to another host.
- Disconnecting or revoking a provider immediately blocks new brokered calls.
- A Pipes proof of concept, if approved, demonstrates token refresh and
  reauthorization without returning an access token to the agent or module.

### FR-009: Declarative infrastructure requests

Trusted builders can propose only supported tenant-scoped infrastructure
resources. The platform returns a plan including ownership, region, quota,
estimated cost class, and destructive effects before approval.

Acceptance criteria:

- No plan is applied without `module.dev.infrastructure.approve`.
- Paid resources require a separate explicit commercial approval.
- Apply and rollback are idempotent, resumable, and audited.
- Tenant users cannot modify platform-wide or other-tenant resources.

### FR-010: Continuous validation

The MCP can run formatting, type, unit, manifest, permission, isolation,
dependency, secret, egress, health, and compatibility checks.

Acceptance criteria:

- The same immutable validation bundle is used for preview promotion and
  production publication.
- Failures identify the file, rule, and remediation without leaking platform
  internals or secrets.
- Required checks cannot be disabled by workspace code or an MCP client.

### FR-011: Tenant-branded live preview

An authorised user can start a time-limited preview composed with synthetic
or approved tenant context and the tenant's resolved design tokens.

Acceptance criteria:

- Preview URLs are unguessable, authenticated by default, tenant-bound, and
  expire automatically.
- The preview visibly identifies itself as non-production and shows its data
  mode.
- Signed module context uses a preview-specific audience and cannot be replayed
  against production.

### FR-012: Publication proposal and approval

A builder submits an immutable version containing source revision, artifact
digest, manifest, requested capabilities, validation evidence, preview link,
and rollback target. A separate publish permission controls promotion.

Acceptance criteria:

- Material changes after approval invalidate the approval.
- The approver sees plain-language data, credential, egress, infrastructure,
  and cost impacts.
- Tenant policy can require the publisher to be different from the submitter.
- An AI agent cannot approve its own publication.

### FR-013: Deployment and module registration

On approval, the platform deploys the immutable remote artifact through a
provider adapter, verifies health, registers the tenant-private manifest
version, and grants entitlement only to the owning tenant.

Acceptance criteria:

- A tenant-created module key cannot collide with platform or another tenant's
  key.
- Failed health or composition checks prevent activation.
- The platform route supplies only a short-lived, module-bound signed context.
- Previous healthy versions remain available for rollback.

### FR-014: Audit, observability, and evidence

All privileged and credential-touching operations append to the existing
hash-chained audit system in the same transaction as their control-plane
state change where applicable.

Acceptance criteria:

- Evidence connects MCP client, user, tenant, workspace, module version,
  sandbox, tool call, capability decision, deployment, and audit sequence.
- Logs redact tokens, source secrets, genuine record content, and generated
  prompts according to policy.
- Tenant publishers can inspect build and runtime health without platform-admin
  access.
- Selected audit events can be replicated through an outbox to WorkOS Audit
  Logs without making WorkOS the transactional or tamper-evident source of
  truth.

### FR-015: Revocation, disable, and rollback

Authorised users can revoke an MCP client, terminate workspaces and previews,
disable a module, revoke its broker capabilities, or roll back to a prior
healthy version.

Acceptance criteria:

- Module disable blocks new operations while preserving source and data.
- Emergency disable does not depend on the module deployment being healthy.
- WorkOS membership, role, permission, session, and agent-registration events
  invalidate affected local grants idempotently.
- Revocation and rollback actions are attributable and audited.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Fail closed; tenant, actor, client, module, and audience binding at every boundary; no token passthrough; no raw secret exposure. |
| Isolation | Untrusted code runs only in ephemeral microVM/container isolation with no ambient credentials and deny-by-default egress. |
| Compliance | SOC 2-compatible evidence for privileged actions; configurable retention and regional processing; genuine client data prohibited until the platform's production gates are satisfied. |
| Reliability | Idempotent workspace, validation, publication, deployment, disable, and rollback operations; resumable long-running jobs. |
| Performance | Tool metadata calls p95 under 1 second excluding identity-provider latency; sandbox-ready p95 target under 10 seconds, subject to pilot measurement. |
| Availability | Developer MCP failure must not affect tenant module runtime or the core platform; publication fails closed. |
| Portability | Sandbox, source-control, and deployment providers sit behind adapters; source and manifest are exportable. |
| Provider boundary | Modules consume OpenTenant permissions, signed context, and broker APIs; WorkOS IDs, SDKs, and tokens never become module contracts. |
| Cost control | Per-tenant quotas, concurrency, duration, storage, egress, and budget alerts; paid operations require explicit approval. |
| Accessibility | Admin workflows meet WCAG 2.2 AA; capability and publication impacts are understandable without developer terminology. |

## 9. Implementation phases

Time boxes are planning targets, not delivery commitments. Each phase requires
its own design, threat model, test plan, evidence PR, and owner approval where
it changes spend or production infrastructure.

### Phase 0: Contracts and threat model — 1–2 weeks

- Define Developer MCP OAuth resource, permissions, client consent, capability
  vocabulary, tenant-private module identity, and audit events.
- Configure and test the WorkOS AuthKit MCP resource indicator, protected
  resource metadata, audience validation, CIMD compatibility, token
  introspection, and revocation behaviour in staging.
- Freeze the initial RBAC permissions and FGA resource hierarchy/slugs; model
  IdP group precedence and separation-of-duties publication policy.
- Request availability and commercial details for Agent Registration, FGA,
  Pipes, Vault, Audit Logs, and any required production features; no purchase
  or enablement is implied.
- Extend the module manifest and registry design for tenant ownership,
  lifecycle state, artifact digests, and declared capabilities.
- Threat-model confused deputy, prompt injection, supply chain, cross-tenant
  access, credential exfiltration, malicious previews, and cost abuse.

Exit: approved ADRs, schemas, permission matrix, threat model, and test plan.

### Phase 1: Sandbox contract and container foundation — 1–2 weeks

- Define the provider-neutral `SandboxAdapter`, typed lifecycle errors, bounded
  command and preview contracts, and adapter conformance suite.
- Build a deterministic in-memory/fake adapter for tests and complete narrow
  sandboxd and Vercel feasibility probes without committing to a paid plan.
- Scaffold, build, test, and serve one approved template using synthetic data,
  no ambient credentials, and no tenant or control-plane access.
- Record provider capabilities, gaps, cost assumptions, licence provenance,
  and the production-isolation decision gate.

Exit: one provider adapter passes the lifecycle conformance suite and produces
a working synthetic-data preview with deterministic teardown; the control
plane remains provider-independent.

### Phase 2: Read-only Developer MCP and workspace orchestration — 2 weeks

- Implement authentication, tenant binding, permission-filtered tool
  discovery, versioned platform resources, templates, workspace metadata, and
  hash-chained audit.
- Expose the Phase 1 sandbox lifecycle through bounded MCP tools; add logs,
  quotas, the validation bundle, and authenticated tenant-branded previews.
- Add RBAC/FGA checks, feature-flagged pilot targeting, WorkOS event-driven
  invalidation, and—if available—the user-bound Agent Registration proof of
  concept with anonymous registration disabled.

Exit: both pilot personas can connect an agent, scaffold a module, and reach a
working synthetic-data preview without ambient credentials or unrestricted
egress.

### Phase 3: Publication and remote-module registration — 2–3 weeks

- Implement immutable artifacts, approval evidence, deployment adapter,
  health gate, tenant-private registration, entitlement, disable, and rollback.
- Keep production data and external credentials unavailable.

Exit: an authorised publisher can promote and roll back a low-risk module for
a test tenant.

### Phase 4: Brokered tenant capabilities — 2–4 weeks

- Add group-assigned trusted-builder profiles, typed data APIs, credential
  proxy, egress policy, and declarative infrastructure planning in that order.
- Introduce genuine data only after production identity, domain, protection,
  backup, and client-data gates are complete.

Exit: approved pilot modules use selected capabilities without receiving raw
secrets or reusable infrastructure access.

### Phase 5: Controlled pilot and hardening — 2 weeks

- Run developer and non-technical-admin pilots; measure time-to-preview,
  intervention, failure, security, cost, and rollback outcomes.
- Remediate findings, document operations, and decide whether to expand beyond
  tenant-private modules.

Exit: P0 metrics met, incident and rollback exercises passed, and owner go/no-go
recorded.

### Future capability: Module Improvement Lab

After the controlled pilot, OpenTenant may add a governed continual-improvement
loop for tenant modules. This is not part of the foundation delivery. Its
separate product requirements are defined in
[`2026-07-19-module-improvement-lab-prd.md`](2026-07-19-module-improvement-lab-prd.md).

Each module can define a versioned quality contract containing simulated user
journeys, expected business outcomes, accessibility and security assertions,
performance budgets, and regression benchmarks. Pre-ship candidates run that
contract inside an isolated sandbox. Post-ship, consented and redacted usage
traces, failures, support signals, and outcome metrics can be clustered into
recurring problems without exposing raw tenant content to a model.

The improvement loop is `observe → reflect → code → review → compare`:

1. Evidence identifies a measurable failure cluster or opportunity.
2. An agent proposes a hypothesis and adds a regression benchmark.
3. The agent produces a candidate in a fresh sandbox checkpoint.
4. The platform compares candidate and baseline across the full quality
   contract and, where authorised, a limited A/B experiment.
5. A human reviews the hypothesis, diff, benchmark deltas, tenant impact, and
   rollback plan before publication.

Tenant policy selects one of three modes: **Observe** produces insights only;
**Propose** may produce code and evidence; **Experiment** may run a capped A/B
release with automatic rollback. No mode silently edits or promotes production
code. Cross-tenant learning is opt-in and shares only approved benchmark
patterns or aggregated measures—not tenant records, traces, prompts, source,
or generated modules.

The concept is informed by Replit's description of a continual-learning system
that analyses feedback, proposes improvements, and validates changes using
benchmarks and A/B tests. OpenTenant adds tenant isolation, explicit consent,
human publication, immutable evidence, and rollback as non-negotiable product
boundaries. [The Self-Driving Company](https://x.com/amasad/status/2077802290304684404)

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| MCP confused-deputy or token replay | Cross-client or cross-service authority reuse | Resource-specific audience validation, no token passthrough, PKCE where applicable, per-client consent, short sessions, nonce/state protection, revocation tests. |
| Stale RBAC/FGA or agent authority | Revoked user continues a sensitive operation | Short-lived audience-bound tokens, synchronous checks for high-risk tools, one idempotent WorkOS event stream, cache invalidation, emergency deny list. |
| Prompt injection or malicious generated code | Data exfiltration, destructive actions, abuse | Isolated sandbox, no ambient credentials, deny-by-default egress, brokered tools, human publication approval, immutable evidence, quotas and kill switches. |
| “Full access” becomes a security bypass | Tenant or platform compromise | Capability profiles remain tenant-scoped and brokered; raw secrets and control-plane access are impossible for every profile; high-risk tools need explicit approval. |
| Dependency or build-chain compromise | Malicious artifact reaches a tenant | Pinned templates and lockfiles, registry/package policy, vulnerability and secret scanning, artifact digests, immutable validation, provenance and rollback. |
| Tenant module destabilises the platform | Availability or UX failure | Remote-only execution, health/readiness gates, timeouts, circuit breaking, version pinning, independent disable and rollback. |
| Runaway sandbox or infrastructure spend | Unexpected platform cost | Per-tenant quotas and budgets, short default lifetimes, concurrency caps, cost plans before apply, separate approval for paid resources. |
| Non-technical user misunderstands capability impact | Accidental exposure or publication | Plain-language capability summaries, synthetic-data default, preview watermarks, explicit approvals, publisher separation option, safe templates. |
| Data residency or retention mismatch | Contractual/compliance breach | Keep genuine data out of early phases; select region-aware providers; minimise sandbox data; configurable retention and deletion evidence before live-data enablement. |
| WorkOS feature or plan dependency | Design depends on unavailable or uneconomic functionality | AuthKit MCP OAuth is the baseline; Agent Registration, FGA, Pipes, Vault, and Audit Logs receive availability, price, region, and fallback gates before adoption; provider-specific details stay behind OpenTenant contracts. |
| Sandbox provider becomes the product architecture | Provider constraints or failure force a platform rewrite | Keep identity, policy, state, and audit in OpenTenant; enforce one adapter contract and conformance suite; retain at least one test adapter. |
| Early container isolation is mistaken for an untrusted production boundary | Cross-workspace or host compromise | Synthetic data only during the foundation, no ambient credentials, provider-specific threat review, and a separate production-isolation gate before untrusted tenant pilots. |
| Third-party source provenance is unclear | Licence or supply-chain exposure | Pattern research by default; copy code only from an exact revision after licence ownership, dependency, security, and attribution review. |

## 11. Dependencies

- Existing module SDK (target namespace `@opentenant/module-sdk`), module registry, tenant entitlements, remote
  composition proxy, and Ed25519 signed module context.
- Local or Better Auth browser identity for the built-in code/PKCE issuer,
  organization mapping, registered clients and resource-specific metadata.
  WorkOS verification remains an optional separately reviewed hosted composition.
- WorkOS FGA if approved after availability and commercial review; the initial
  resource hierarchy and immutable slugs must be settled before configuration.
- Optional Agent Registration, Directory Sync group mapping, Feature Flags,
  Audit Logs, Pipes, and Vault only at the phases and boundaries stated above.
- Existing hash-chained control-plane audit store and encrypted credential
  vault.
- A tenant-private module registry and version lifecycle extension.
- Approved sandbox and deployment adapters; sandboxd is evaluated as a
  local/self-hosted adapter and Vercel Sandbox as a hosted pilot adapter.
  Vercel REST/SDK access must respect the repository's no-CLI operational
  rule.
- Production gates before genuine client data: protected deployments,
  verified production identity, stable public origin, owner-approved backup
  retention and recovery targets, data-region validation, incident and restore
  exercises.

The Developer MCP is not a dependency of WP-D.2 brain ingestion. It is a
separate future workstream that can consume the ingestion and Brain MCP
capabilities later through explicit permission grants.

## 12. Remaining decisions and future adapter choices

The v1 source model, publication approval modes, two permission profiles,
first brokered module-data capability, no-egress stance, and local
resource-authorization adapter are settled in `docs/OWNER-TASKS.md`. The first
callable route remains the single governed Developer MCP owner gate. Longer-term
choices are:

1. Whether the selected Vercel Sandbox adapter passes the production gate,
   including its region, isolation class, plan, quotas, retention, support,
   and cost ceiling after the conformance spike.
2. Whether non-technical administrators use a platform-embedded agent,
   approved external MCP clients, or both in the first pilot.
3. Which WorkOS capabilities are included in the current commercial plan and
   production region, and the approved incremental cost ceiling.
4. Whether WorkOS Agent Registration is available for OpenTenant and should become
   the preferred AI-agent identity path after its staging proof of concept.
5. Whether enterprise audit export uses WorkOS Audit Logs, and which curated
    events may leave the canonical OpenTenant hash chain.
6. Whether Pipes or Vault offers enough provider coverage, BYOK, and
    operational benefit to replace any future in-house capability—not the
    already-shipped WP-D.1 vault—after a separate migration decision.

## 13. Research and rationale

- The MCP authorization specification requires resource-specific token
  validation and prohibits token passthrough, directly informing the separate
  Developer MCP audience and broker model:
  [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
- MCP security guidance describes per-client consent for MCP servers that
  proxy third-party services, informing the client registry and consent
  requirements:
  [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).
- WorkOS AuthKit can act as the Developer MCP authorization server, including
  Resource Indicators, protected-resource discovery, OAuth metadata, audience-
  bound JWT validation, introspection, and client registration compatibility:
  [WorkOS MCP authorization](https://workos.com/docs/authkit/mcp).
- WorkOS Agent Registration can bind an AI agent to a user through a claim
  ceremony and issue tenant- and actor-attributable credentials; it must first
  be enabled for the environment, so it remains a gated enhancement:
  [WorkOS Agent Registration](https://workos.com/docs/authkit/agent-auth).
- WorkOS RBAC supplies organisation-wide roles and IdP group mapping, while FGA
  supplies resource-scoped and inherited permissions, informing the two-level
  authorization model:
  [WorkOS RBAC](https://workos.com/docs/rbac) and
  [WorkOS FGA](https://workos.com/docs/fga/roles-and-permissions).
- WorkOS Feature Flags, Events, and Audit Logs can support staged rollout,
  revocation propagation, and customer-facing evidence, while OpenTenant retains
  authorization and its canonical hash chain:
  [Feature Flags](https://workos.com/docs/feature-flags),
  [Events](https://workos.com/docs/events), and
  [Audit Logs](https://workos.com/docs/audit-logs).
- Vercel positions Sandbox for untrusted and AI-generated code, with isolated
  microVMs, live previews, and programmatic SDK control, informing the sandbox
  adapter candidate:
  [Vercel Sandbox](https://vercel.com/docs/sandbox).
- Vercel documents network-boundary credential injection that keeps tokens out
  of the sandbox, informing the brokered credential requirement:
  [credential injection](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox).
- sandboxd provides an API-first container lifecycle, preview routing,
  checkpoints, Git operations, and a credential-injecting proxy. Its own beta
  notice identifies container rather than VM isolation, single-server scope,
  and authentication hardening as production gates:
  [sandboxd repository](https://github.com/tastyeffectco/sandboxd).
- OpenFlow validates demand for multi-tenant agent/workflow tooling and offers
  useful execution and MCP patterns, but its Supabase/Fly/Cloudflare stack and
  in-progress runtime migration do not provide the required module-code
  sandbox boundary:
  [OpenFlow repository](https://github.com/daviddominguezh/llm-graph-builder).
- Replit describes a continual-learning loop combining user feedback,
  benchmarks, A/B tests, agent-assisted review, and human direction. This
  informs the deferred Module Improvement Lab while leaving production
  promotion under explicit tenant control:
  [The Self-Driving Company](https://x.com/amasad/status/2077802290304684404).

## 14. Self-score

| Area | Score | Notes |
|---|---:|---|
| AI-specific optimisation | 24/25 | Sequential phases, tool-safe boundaries, explicit agent consent and sandbox requirements; exact tool schemas deferred to design. |
| Traditional PRD core | 24/25 | Vision, measured baseline, prioritised goals, non-goals, personas, and acceptance criteria; commercial model intentionally excluded. |
| Implementation clarity | 28/30 | Coded requirements, security architecture, dependencies, phases, and NFRs; provider and data API choices remain open by design. |
| Completeness | 19/20 | Risks, mitigations, research, open decisions, recovery, accessibility, and cost controls covered; pilot participants not yet named. |
| **Total** | **95/100** | Owner approved the foundation direction; ready for a detailed delivery plan and independent security review. |

Adversarial review: local challenge pass applied. Owner approved the
adapter-first foundation on 2026-07-19; independent implementation and
security review remain delivery gates.

## Local integration checkpoint, 2026-11-11

The route consumes built packages and canonical migrations. A local issuer uses
local or Better Auth browser sessions for explicit project consent, registered
redirects and one-use S256 authorization codes. Resource metadata and issuer
metadata have well-known aliases. Mutating tools require a separate authenticated
browser confirmation bound to tenant, user, client, project and exact input. CI
checks exact database test counts. These local proofs do not approve production
enablement or establish real microVM isolation. See the
[operator flow](../runbooks/developer-mcp.md#integrated-local-flow).
