# Multi-tenant owner, managed support, and module operations

Status: approved design; delivery sequence item 1 implemented and verified

Updated: 2026-07-22

This document extends the [platform architecture](platform-architecture.md)
with the operating model for an installation owner that manages multiple
customised tenants. It also defines managed-support access, module ownership
and data scopes, compliance evidence, and the first-class helpdesk experience.

The design is deliberately provider-neutral at the application boundary. The
initial hosted stack remains Vercel, Neon PostgreSQL, and either WorkOS or Clerk
per installation.

## 1. Product model

One OpenTenant installation has exactly one **multi-tenant owner**. The owner
may be an agency, a small SaaS company, or an enterprise platform team. The
owner creates and manages one or more **tenants**, each representing a distinct
customer, business unit, community, or other organisation.

```text
OpenTenant installation
└── multi-tenant owner
    ├── owner administrators and support operators
    ├── shared modules, policies, and integrations
    ├── tenant A
    │   ├── members, brand, domains, modules, and data plane
    │   └── tenant-private modules and integrations
    └── tenant B
        ├── members, brand, domains, modules, and data plane
        └── tenant-private modules and integrations
```

The owner console is part of the installation. A tenant does not register a
second application with an external agency console. Creating the tenant in the
owner console registers it automatically in the installation control plane.

An installation selects WorkOS or Clerk for hosted identity. It does not mix
identity providers between tenants. Vercel and Neon are the first supported
hosted adapters, while their account, team, project, region, domain, and
resource identifiers remain runtime configuration.

## 2. Goals

- Give an installation owner one operational console across all of its tenants.
- Make every tenant independently brandable, configurable, and isolated.
- Let owner administrators create and configure a tenant on the organisation's
  behalf without requiring a second registration workflow.
- Permit practical managed-support work while retaining the real operator's
  identity, permissions, reason, and audit evidence.
- Support platform, owner-shared, and tenant-private module ownership without
  silently widening a module's audience or data authority.
- Give modules useful data capabilities, including explicitly approved broad
  tenant access, without handing remote code raw database or provider secrets.
- Turn support into a first-class tenant and owner workflow with optional Slack
  delivery rather than a disconnected example.
- Produce evidence that can support a future SOC 2 programme and optional Vanta
  integrations without claiming certification.

## 3. Non-goals

- A global OpenTenant SaaS control plane that automatically receives every
  adopter's tenant data.
- A second agency application that client installations must register with.
- Mixing WorkOS and Clerk inside one installation.
- Giving platform or support staff unrecorded access as another user's identity.
- Making tenant-created modules shareable across other tenants by default.
- Giving remote modules direct Neon, Vercel, WorkOS, Clerk, Slack, or Vanta
  credentials.
- Treating a Slack message, Vanta record, or provider response as the canonical
  business record.
- Claiming SOC 2 compliance or Vanta readiness from implementation alone.

## 4. Owner console

The owner console is a control-plane surface for users with installation-level
permissions. It provides:

- tenant creation, suspension, recovery, deletion workflow, and status;
- tenant brand, domains, enabled modules, navigation, and integration health;
- membership and identity-provider organisation health without exposing raw
  provider identifiers in normal UI;
- tenant database, migration, backup, restore, and regional-policy status;
- support queues, SLA health, incidents, and managed-support entry;
- module catalog, owner-shared module versions, compatibility, and rollout;
- audit, security, compliance, delivery, and provider-adapter health; and
- explicit links from an owner record into a tenant-bound operational context.

Owner-wide list and health views use control-plane metadata and projections.
They do not issue an unbounded fan-out query across every tenant database on
each page load. Opening tenant content resolves the current tenant locator and
reauthorises the operator against that tenant and action.

The console must remain useful to a small team: sensible role templates,
defaults, bulk-safe operations, strong search, and visible failures take
priority over a complex policy authoring language in the first release.

## 5. Tenant creation and brand seeding

The usual onboarding path is an owner administrator creating a tenant and
performing its minimum technical setup on behalf of the organisation.

Required input is limited to a display name and the installation's minimum
technical configuration. Tenant creation initializes an empty brand policy and
does not accept or enqueue a website source under installation authority.

OpenTenant does not invent a brand or voice. Optional brand fields start empty
and the tenant owner or tenant administrator can complete them manually.

After tenant creation, a tenant owner or administrator with the exact
`brand.proposal.upload` permission may supply a website URL. A later
brand-seeding job may propose:

- organisation name and short description;
- colours, typography hints, logo candidates, and icon candidates;
- tone and voice notes;
- public contact and social links; and
- a source URL and retrieval timestamp for every proposed value.

Seeding is a proposal, not an automatic activation. The operator reviews and
edits it before applying typed brand fields. Fetching treats DNS, redirects,
HTML, metadata, images, and generated summaries as hostile. The fetcher blocks
private/link-local destinations, bounds redirects and payload size, validates
media types, strips active content, records provenance, and never copies a
third-party asset into a distributable template without a licence decision.

Tenant creation is resumable and independent of brand seeding. Brand seeding
failure never rolls back an otherwise valid tenant.

The brand fetcher requires deterministic denial tests for unsupported schemes,
userinfo, disallowed ports, private/link-local/loopback addresses, DNS rebinding,
redirects to newly prohibited addresses, address changes after resolution,
invalid TLS, timeout, redirect count, compressed and decompressed size, content
type, image dimensions, parser failure, and hostile active media. Tests pin the
resolved address used for each request rather than validating one address and
connecting to another.

## 6. Managed support and tenant context

A tenant may enable **managed support**. The normal installation policy can
enable it during tenant creation; the setting remains visible and auditable.

An authorised owner operator enters a tenant through a managed-support session.
The session changes the active tenant context but never replaces the actor with
a fictional tenant user. Every request retains:

- the real operator ID and installation permissions;
- the tenant entered;
- the support session and reason;
- start, last activity, and expiry timestamps; and
- any ticket, incident, or change reference when supplied.

This is a separate, short-lived authorization context, not a tenant-membership
bypass. The identity gateway first authenticates the operator and their current
installation authority. A `SupportContextResolver` then validates an opaque
server-side support-session record bound to installation, tenant, operator,
reason, allowed action classes, creation, expiry, and revocation state. Tenant
handlers explicitly accept either a normal verified tenant membership or a
valid support context for that handler's permission. They never suppress or
reinterpret `tenant_mismatch`, and a support session cannot be presented as a
normal tenant membership to modules or external services.

Managed support is not read-only. When enabled, the standard support-operator
grant permits routine configuration work:

- brand fields and approved assets;
- enabled modules, non-sensitive module settings, and navigation when the change
  does not add a new or broader data capability;
- domain metadata and verification workflows without activating or rerouting a
  production hostname;
- non-sensitive integration metadata and health remediation without changing
  destination, OAuth scope, credential, or data-access purpose; and
- other explicitly classified routine tenant settings.

The following are sensitive operations rather than routine support:

- reading or exporting customer records;
- viewing, copying, or replacing credentials outside an approved connection
  flow;
- bulk exports;
- destructive deletion or retention changes;
- billing and subscription changes; and
- user identity, ownership, or high-privilege membership changes;
- granting a module a new or broader data capability;
- activating or rerouting a production domain; and
- changing an integration's destination, OAuth scope, credential, or data
  purpose.

Sensitive actions are not permanently impossible for a super administrator.
They require a separate permission, a fresh authorisation check, a reason, and
strong audit evidence. Deployments may additionally require step-up
authentication or tenant approval by policy. This keeps emergency and practical
support possible without making broad access ambient or invisible.

The UI displays a persistent managed-support banner, tenant identity, operator
identity, elapsed session time, and exit action. Tenant switching ends the old
support context and creates a new one; it never mutates an existing session in
place.

Provider-native impersonation tokens remain denied at the identity gateway.
OpenTenant's managed-support session is the governed cross-tenant mechanism.

Helpdesk service and managed support are independent settings. A tenant may use
the helpdesk without granting owner operators routine configuration access, and
managed support may be enabled without exposing a customer-facing ticket form.
Disabling managed support revokes active support sessions immediately without
deleting tickets or their retention evidence.

## 7. Permission model

Permissions, not provider role names, protect server operations. Initial role
templates may make setup convenient, but every handler checks explicit
installation or tenant permissions.

The first delivery slice exposes a provider-neutral `InstallationAuthority`
contract and an explicit installation-permission authorization entry point.
For compatibility, the existing platform-administrator flag is converted at
that single seam into installation-owner permissions; tenant membership roles
and tenant/module permission claims are never accepted as installation
authority. The legacy storage terminology remains internal until a later
additive persistence migration is justified.

The compatibility grant is deliberately limited to the installation operations
already integrated: `owner.tenant.create`, `owner.tenant.read`,
`owner.audit.read`, `owner.support.enter`, `owner.support.configure`, and
`owner.helpdesk.queue.read`. The platform administration overview, audit log,
and tenant-creation pages authorize through this seam. Representative
permissions below are vocabulary, not ambient grants; later handlers require
explicit persisted or short-lived authority before using them.

Representative installation permissions are:

- `owner.tenant.create`, `owner.tenant.read`, `owner.tenant.configure`;
- `owner.tenant.suspend`, `owner.tenant.delete`;
- `owner.support.enter`, `owner.support.configure`;
- `owner.support.customer_data.read`, `owner.support.customer_data.export`;
- `owner.support.credential.rotate`, `owner.support.data.delete`;
- `owner.support.billing.manage`, `owner.support.identity.manage`;
- `owner.support.module_grant.manage`, `owner.support.domain.activate`;
- `owner.support.integration.authorize`;
- `owner.module.publish_installation`, `owner.module.assign`;
- `owner.audit.read`, `owner.compliance.manage`; and
- the helpdesk permissions in section 12.

`platform.module.publish` is reserved for the OpenTenant release process and is
not included in an installation-owner role template.

Tenant permissions remain tenant-bound and include membership, branding,
domain, module, integration, support, and data capabilities.

The effective authority for an action is the intersection of:

1. the authenticated actor's installation authority;
2. the active tenant membership or managed-support grant;
3. the resource's tenant and ownership scope;
4. the operation-specific permission; and
5. any step-up, approval, or policy condition for a sensitive action.

Missing, contradictory, stale, or ambiguous scope fails closed.

Sensitive support permissions are evaluated independently at each handler and
are short-lived or revocable when granted for an incident. Reads and exports
write their access evidence before returning data. Deletes, credential changes,
billing, and identity mutations use the same transactional mutation/evidence
rule as other privileged state. A broad `superadmin` label never substitutes for
the operation-specific permission.

## 8. Module ownership and sharing

OpenTenant supports three module ownership scopes:

| Scope | Created and governed by | Availability |
|---|---|---|
| Platform | OpenTenant repository/release | Available to every compatible installation, subject to entitlements |
| Installation owner | The multi-tenant owner | May be assigned to selected tenants in that installation |
| Tenant private | A tenant developer or authorised tenant administrator | Available only to that tenant |

A tenant-private module cannot be toggled into another tenant. A future
promotion workflow may review and copy a module into a new installation-owned
artifact, but that creates a new ownership record, version, provenance chain,
security review, and publication decision. It is not an in-place scope change.

Ownership scope is immutable. Installation owners can publish only
installation-owned modules, while the OpenTenant release process alone creates
platform-owned versions. Promotion always produces a new artifact digest and
record; it never edits the owner/scope fields of an existing version.

Every module version is immutable after publication. Entitlements refer to a
specific compatible release or an explicit rollout channel. Disable, rollback,
and quarantine do not destroy historical evidence.

The first local implementation slice now enforces these ownership and copy
boundaries in the provider-neutral domain and PostgreSQL control plane. It does
not expose a public promotion route or deploy a promoted artifact; those remain
separate publication and provider-adapter work.

Remote module destinations are an explicit publication boundary. Storage and
runtime resolution deny remote delivery unless the exact provider-managed DNS
hostname is configured in `MODULE_REMOTE_HOST_ALLOWLIST`; IP literals, local
hosts, userinfo, and non-standard HTTPS ports are invalid. The proxy rejects
decoded catch-all segments that could change origin or traverse paths, never
follows an upstream redirect, and constructs outbound headers from an allowlist
instead of forwarding platform cookies, authorization, or arbitrary input.
Operators should allow only deployment-provider hostnames whose DNS they trust,
not mutable customer vanity domains.

## 9. Module data access

Modules receive no tenant data by default. A versioned manifest declares the
capabilities it needs, and installation or tenant policy grants a subset.

The effective capability set is the intersection of:

```text
manifest request
∩ owner/tenant grant
∩ module creator's delegable authority
∩ current user's permissions or approved service grant
∩ active tenant boundary
```

Capabilities should describe useful business resources and operations rather
than provider credentials. Examples include:

- `records.customer.read`;
- `records.customer.write`;
- `support.ticket.read`;
- `files.private.read`;
- `integration.crm.invoke`;
- `tenant.database.query.restricted`; and
- `tenant.database.access.broad`.

Broad access is supported when the module genuinely needs it; it is not hidden
behind an impossible process. It is nevertheless conspicuous, version-bound,
separately grantable, and auditable. The UI explains the requested reach and
shows which tenants granted it.

Broad data capability is separated into read and write grants. Each grant is
version-bound, tenant-bound, time-bounded where practical, revocable, and
constrained by an operation/schema allowlist. The broker rejects prohibited SQL
classes, cross-database access, role/session changes, extension and DDL changes,
unsafe functions, unbounded statements, and multi-statement ambiguity unless a
separately reviewed native migration path owns the operation. It enforces
statement timeout, concurrency, row, byte, cost, transaction, and egress limits.
Cross-tenant, stale-grant, revocation, query-confusion, and resource-exhaustion
cases are mandatory adversarial tests.

Remote modules do not receive raw database connection strings. A tenant-bound
data broker or proxy validates the signed module context, capability, query or
operation class, resource limits, and result shape. Trusted native modules may
use tenant-bound application transactions, but still declare and test their
data surface. Background jobs use an approved service grant rather than the
last interactive user's authority.

The first capability system should favour a small composable vocabulary and
observable denials over hundreds of table-specific permissions. Resource-level,
row-level, field-level, purpose, volume, and egress constraints can be added
where risk or customer need justifies them.

All module data paths record module key and version, tenant, actor or service
grant, capability, operation class, result count/size class, decision, and
correlation ID. Logs and audit details never include secrets or unrestricted
record bodies.

The first implemented slice deliberately contains one operation:
`support.ticket.read` may return at most 25 ticket-number, category, status,
priority, and update-time summaries. The signed context is bound to the exact
module version and reaches the broker only as strict bearer authorization.
PostgreSQL makes declarations immutable with their module version and retains
one-way grant revocation history. Subject, description, identifiers, messages,
events, database credentials, caller-selected queries, service grants, and
broad read/write capabilities remain outside this slice.

## 10. Developer MCP relationship

The Developer MCP uses the same module ownership and capability vocabulary but
does not automatically receive the capabilities it can describe.

- A tenant developer creates a tenant-private module.
- An owner developer may create an installation-owned module only with the
  corresponding installation permission.
- The coding agent may request capabilities in a manifest, but cannot grant or
  approve them.
- Generated code runs only in the approved isolated sandbox.
- Publication evidence is immutable and separately authorised.
- Runtime data access occurs through the module capability boundary, not
  through the development sandbox or MCP bearer token.

### Module UI boundary

Installation-owner and tenant-private modules may use the Apache-licensed
Next.js UI starter in `templates/tenant-module-nextjs`. It provides semantic
brand tokens and local, source-owned shadcn/ui primitives without sharing the
platform process or granting data capabilities. UI selection and module data
authority remain independent decisions.

Licensed Shadcn Studio resources belong only to the separately released
OpenTenant marketing end product. They are not an approved Developer MCP
registry, tenant template, installation-owner component library, or source for
cross-tenant module promotion. This prevents licensed builder assets and their
credentials from crossing the reusable product boundary.

This separates code generation, publication, installation, runtime authority,
and support operations into independently auditable decisions.

## 11. Support as a first-class feature

The existing support module already provides tenant-local ticket numbers,
categories, status, priority, assignment, public replies, internal notes, and
transactional events. The next design promotes support from an example into an
optional first-party tenant module plus an installation-owner operational
surface.

The canonical ticket, message, note, attachment, and customer-facing history
remain in the tenant data plane. The owner console must not fan out to every
tenant database for each queue view, so a transactional outbox maintains a
minimal, rebuildable control-plane projection.

```text
tenant member or administrator
        │
        ▼
tenant-bound Support Service
        ├── ticket, message, attachment, and event records
        └── transactional outbox
              ├── minimal owner ticket index
              ├── in-app notification delivery
              ├── email delivery adapter
              └── Slack delivery adapter

installation-owner Helpdesk
        ├── queries minimal cross-tenant index
        └── resolves and reauthorises tenant DB for details/mutations
```

The owner projection contains only fields needed for queue operation: stable
ticket reference, tenant, status, priority, category, assignee reference, SLA
state, and timestamps. A bounded display subject is optional by installation
policy; message bodies and attachments are never projected. Projection entries
carry source version and checkpoint data so they can be reconciled or rebuilt.

Projection updates are monotonic per ticket. The outbox event carries the
canonical ticket version, and a consumer cannot replace a newer row with an
older event. Disablement, retention expiry, tenant deletion, and support-module
removal emit tombstones. The owner queue hides inaccessible content immediately
and displays explicit projection lag/health without treating lag as ticket
state. Reconciliation compares tenant checkpoints, repairs missing events, and
purges projection rows only after the canonical retention/deletion workflow is
authorised and evidenced. Removing the tenant-facing support module stops new
intake but preserves governed historical access until retention permits purge.

Ticket creation succeeds or fails with the canonical tenant transaction, not
with Slack, email, or projection delivery. Delivery workers use idempotency
keys, bounded retry, explicit permanent-failure classification, and dead-letter
visibility.

## 12. Helpdesk permissions and experience

Representative tenant and owner support permissions are:

- `support.ticket.create`;
- `support.ticket.read_own` and `support.ticket.reply_own`;
- `support.ticket.read_tenant` and `support.ticket.reply`;
- `support.ticket.note_internal`;
- `support.ticket.assign`;
- `support.ticket.manage`;
- `support.ticket.escalate`;
- `support.config.manage`;
- `support.analytics.read`; and
- `support.knowledge.manage`.

Requesters see their own tickets and public messages. Tenant support staff see
tenant tickets according to their permissions. Owner support staff see
cross-tenant projection rows and open canonical tenant records only when their
installation permission and tenant support context allow it. Internal-note
content, existence, and timing remain hidden from requesters.

The tenant experience provides:

- a persistent, tenant-branded **Get help** action;
- contextual ticket creation;
- My tickets for members and a tenant queue for permitted administrators;
- public replies, attachments, status, resolution, and CSAT; and
- clear notification preferences and per-ticket mute controls.

The owner Helpdesk provides:

- All, Unassigned, Mine, Escalated, and SLA-risk queues;
- tenant, status, priority, category, tag, and assignee filters;
- search by ticket reference and allowed projection metadata;
- a public conversation and separate internal-note composer;
- assignee, priority, SLA, related incident, diagnostics, and audit panels;
- one-save operational updates; and
- an **Enter tenant** action that preserves the ticket reference in the managed
  support session.

Contextual intake may include tenant, module, route, release, correlation ID,
and coarse runtime health after clear disclosure. OpenTenant never silently
attaches form values, customer records, prompts, tokens, raw headers, full
traces, or credentials.

Attachments use private object storage with tenant-bound authorization,
allowlisted media types, bounded size/count, malware scanning where available,
content-disposition safety, retention policy, and audited download. Attachment
failure does not create a ticket with a misleading successful attachment state.

## 13. Slack support transport

Support notifications use a connection purpose distinct from the knowledge
module's Slack ingestion connector. Tokens, scopes, and provider mappings are
not shared merely because both integrations use Slack.

### 13.1 Incoming-webhook phase

The first Slack phase supports one-way notification through an incoming webhook
configured at installation-owner scope or for one tenant.

- The webhook URL is an encrypted secret and is never returned after storage.
- An owner connection may select tenant and event filters; a tenant connection
  can deliver only that tenant's events.
- Messages use Block Kit plus accessible top-level fallback text.
- Tenant labels, ticket reference, category, priority, status, safe bounded
  excerpt, and a deep link are permitted.
- Delivery defaults to metadata only. A safe bounded excerpt is an explicit
  installation or tenant opt-in, and sensitive tenants can prohibit excerpts.
- User content is escaped, links are generated by the server, and link unfurls
  are disabled.
- A manual delivery test clearly identifies its side effect.
- Delivery is asynchronous and cannot block ticket creation.
- Health shows last success, last safe error class, queued attempts, and
  permanent failures without showing the webhook.

Slack incoming webhooks are bound to their configured channel, cannot override
their identity, and cannot delete a posted message. OpenTenant therefore does
not pretend the webhook phase supports channel selection, reliable threading,
or state-changing actions. See [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks).

### 13.2 OAuth Slack-app phase

A later Slack app may add multiple workspaces/channels, bot delivery, ticket
threads, replies, and acknowledge/assign/resolve actions.

The app uses minimal OAuth scopes, stores encrypted bot credentials in the
provider-bound vault, and records workspace/channel/message references in a
mapping table. `chat.postMessage` supplies the canonical message timestamp and
supports thread replies; messages provide accessible fallback content. See
[Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postmessage).

Every inbound action:

1. verifies the Slack signature against the raw bounded request body;
2. rejects stale timestamps and replay;
3. acknowledges within Slack's three-second interaction window;
4. binds the installed app, workspace, channel, and Slack user to an active
   OpenTenant identity;
5. resolves the exact installation, tenant, ticket, and action;
6. creates or validates a short-lived action context bound to that ticket,
   tenant, operator, managed-support/helpdesk policy, reason, and allowed action;
7. reauthorises the action against current OpenTenant permissions and
   revocation state;
8. commits the canonical mutation and audit event; and
9. updates Slack asynchronously with success or a generic failure.

Slack's signed-request protocol, not the deprecated verification token,
authenticates inbound actions. See [verifying Slack requests](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

Slack is a notification and interaction transport. The tenant ticket remains
the source of truth, and losing or disconnecting Slack never loses the ticket.
Uninstall, workspace/app/user remapping, managed-support disablement, and
permission revocation invalidate pending action contexts. Tests cover replay,
cross-workspace and cross-tenant substitution, revoked users, stale buttons,
and provider-retained message data. Installation and tenant policy defines
whether metadata/excerpts may remain externally in Slack and how operators
handle their deletion when the provider supports it.

## 14. Notifications, SLA, and knowledge

The support event stream includes ticket creation, public reply, assignment,
priority/status change, escalation, SLA warning/breach, resolution, reopening,
and CSAT. In-app, email, and Slack adapters subscribe through the outbox.

Each delivery record stores channel, safe destination reference, event and
idempotency key, attempts, state, external message reference, and normalised
last error. Per-user and per-ticket preferences are enforced before delivery.

SLA policy is assigned from installation defaults with tenant overrides where
allowed. It records response and resolution targets, support hours/time zone,
warning thresholds, pause rules, and breach events. A later incident model may
relate many tickets without merging their tenant-private contents.

AI assistance comes after the deterministic workflow. It may suggest category,
priority, duplicates, knowledge articles, and a reply draft. Prompt injection
and ticket attachments are untrusted; model failure never blocks support work.

**Amended 2026-07-28.** This section previously stated that AI does not resolve
a ticket by default. The owner has accepted the AI Support Agent
(`docs/product/ai-support-agent.md`), which permits tiered autonomy up to and
including automatic resolution and production release. The revised position:

- Default autonomy is **T0 (observe)** for both the installation and every
  tenant. Nothing resolves automatically unless a human raises the tier.
- The effective tier is the lower of the installation ceiling and the tenant's
  own setting, so a tenant can always be more conservative than the owner.
- At **T3**, the agent may resolve a ticket and release to production without
  in-band human approval, restricted to the enumerated change-class allowlist
  in the PRD. The approval is carried by pre-authorised policy; the agent never
  approves its own release.
- Absolute exclusions apply at every tier. The agent may never change
  authentication, authorization, permissions, roles, tenant resolution,
  database schema, migrations, the audit pipeline, delivery adapters,
  dependency manifests, or CI and deployment configuration.
- Ticket prose never enters the context of the actor that writes code. Triage
  emits a schema-constrained classification carrying no free text, and a
  deterministic harness converts it into a failing test. No failing test, no
  code change.
- The agent still never discloses another tenant's content, and a public reply
  it composes is labelled as automated.

Knowledge derived from tickets follows the same ownership scopes as modules:
OpenTenant-maintained, installation-owner shared, or tenant private. Publication
is human-reviewed, source-provenanced, and redacted. Tenant-private knowledge is
never used to train or populate another tenant's support experience.

## 15. SOC 2 readiness and Vanta

OpenTenant can produce evidence relevant to a future SOC 2 programme, but the
repository and a deployment must not claim compliance without the organisation's
controls, operating period, auditor, and report.

The design supports evidence for:

- logical access, role and permission changes, support-session entry, and
  periodic access review;
- tenant creation, domain, brand, module, integration, and configuration change
  management;
- code review, CI, release, module publication, rollback, and emergency change;
- availability, backup, restore, incident, support SLA, and delivery health;
- vulnerability, dependency, secret, and sandbox-isolation checks;
- credential creation, use, rotation, revocation, and safe failure;
- data location, retention, export, deletion, and restore exercises; and
- audit-chain verification and evidence-export integrity.

Evidence records use stable internal IDs, timestamps, actor/service identity,
tenant/scope, control or policy reference, safe outcome, and immutable artifact
digests where applicable. Evidence export is explicit, authorised, bounded, and
redacted; it is not a continuous export of tenant content.

Cross-scope evidence has one authoritative contract containing installation,
tenant where applicable, real actor or service identity, support session,
reason, authorization decision and policy version, action, subject, correlation
and idempotency IDs, safe outcome, and prior/current digest. Tenant mutations
and tenant audit commit together. A transactional outbox replicates the minimal
installation evidence needed for owner-wide review; a best-effort UI mirror is
not compliance evidence. Workers reconcile checkpoints and expose lag or
failure. Sensitive reads and exports append evidence before returning data.
Retention, purge, chain verification, replica reconciliation, and tamper tests
are required before calling the export audit-ready.

A future Vanta adapter may operate at either installation-owner scope or tenant
scope:

- an owner connection reports the owner's OpenTenant control environment and
  selected aggregate resources;
- a tenant connection reports only that tenant's explicitly selected resources
  and evidence; and
- one connection can never read or label another connection's tenant resources.

Each connection has an immutable scope record listing authorised tenant IDs (or
an explicit installation aggregate), resource types, allowed fields, purpose,
region/residency constraint, aggregation rule, retention, and revocation state.
Adding a tenant, field, resource type, or purpose requires a new consented scope
version; an owner connection cannot expand automatically as tenants are created.
Tenant connections cannot request aggregate resources. Revocation stops new
delivery immediately and records the disposition of already exported evidence.

The adapter starts read-only or evidence-push-only with least privilege. It uses
the existing encrypted connection boundary, normalised errors, idempotent jobs,
resource scoping, and audit. Provider SDK/API objects do not enter module
contracts. Vanta's API currently supports private integrations, evidence
automation, custom resources/tests, reporting, and external workflows, making
this technically plausible; exact endpoints, plan availability, and data
residency require a separate implementation decision. See the
[Vanta API overview](https://help.vanta.com/en/articles/11345411-vanta-api) and
[Vanta Developer Hub](https://developer.vanta.com/).

Vanta MCP, if used by an operator, is a separate human-authorised compliance
tool. It does not become a tenant module capability, receive unattended
provider authority, or replace OpenTenant's evidence store.

## 16. Data and control-plane additions

The implementation should extend existing stores rather than introduce one
large framework. Expected conceptual records include:

- installation owner profile and policy;
- managed-support policy, session, and reason;
- module ownership, immutable version, grant, rollout, and quarantine;
- module capability definition, request, grant, service grant, and decision;
- tenant onboarding proposal and source provenance;
- support ticket projection and projection checkpoint;
- support delivery outbox, delivery attempt, preference, and external mapping;
- support SLA policy and state;
- Slack support connection and message mapping; and
- compliance evidence mapping and optional Vanta connection.

Control-plane records contain only the minimum cross-tenant operational state.
Customer content remains canonical in the tenant data plane. Every tenant
locator resolution and tenant-bound command is rechecked at execution time;
cached or projected metadata never grants authority.

## 17. Security and privacy invariants

- The real actor is retained through owner, support, tenant, module, and Slack
  operations.
- A support session grants no more than its current policy and permissions.
- Provider impersonation is denied; managed support is an OpenTenant context.
- Tenant-created artifacts remain tenant private unless copied through a future
  separately governed promotion workflow.
- Module creator authority caps what can be delegated at publication time.
- Runtime user or service authority caps what can be exercised at invocation.
- Remote modules receive brokered capabilities, not raw credentials.
- Tenant data does not enter owner projections, Slack, AI, Vanta, telemetry, or
  logs unless a documented, bounded policy permits the exact field and purpose.
- External delivery and projection failure cannot corrupt canonical tenant
  state.
- Every cross-tenant owner view resolves content through a fresh tenant-bound
  authorization decision.
- High-impact actions are attributable, reasoned, and tamper-evident.
- Unknown scope, inconsistent mapping, ambiguous tenant binding, or stale
  authority fails closed.
- Support context is separately validated after installation authentication and
  never weakens normal identity-provider tenant-membership checks.
- Owner projections use monotonic versions and tombstones and cannot preserve
  access after the canonical policy revokes it.

## 18. Delivery sequence

Implementation proceeds as independently verifiable vertical slices:

1. **Owner and tenant terminology.** Introduce installation-owner contracts and
   permissions while preserving current tenant behavior.
2. **Managed-support context.** Add policy, sessions, audit, banner, routine
   configuration permissions, and sensitive-action separation.
3. **Tenant onboarding.** Add the owner tenant-creation experience and optional
   safe brand proposal with the empty-values path first.
4. **Module ownership.** Add platform, installation-owner, and tenant-private
   ownership plus immutable promotion boundaries.
5. **Module capabilities.** Add denial-first grants and a narrow broker before
   any broad database capability.
6. **Helpdesk core.** Harden the current support module, permissions, event
   contract, outbox, and minimal owner projection.
7. **Helpdesk experience.** Build owner queues and improve tenant requester and
   tenant-admin workflows.
8. **Slack webhook.** Add encrypted one-way delivery, safe messages, manual
   test, retries, and health.
9. **Support depth.** Add email/in-app delivery, attachments, SLA, CSAT, and
   operational analytics.
10. **Slack app.** Add OAuth, multiple channels, threading, signed actions, and
    identity mapping only after the one-way transport is proven.
11. **Compliance adapters.** Add evidence export and optional Vanta integration
    after the evidence model and deployment policies are stable.
12. **AI assistance.** Add reviewed suggestions and scoped knowledge only after
    deterministic support, privacy, and evaluation gates pass.

Each slice requires behavioral tests through public entry points, tenant and
permission denial cases, audit evidence, relevant runtime execution, and
durable documentation updates. Provider-specific work also requires a
development-only probe and cleanup evidence before any production proposal.

## 19. Acceptance criteria

The design is realised only when:

- one installation owner can create and operate multiple independently branded
  tenants from one console;
- tenant creation succeeds with no website and retains empty optional brand
  values;
- any brand seed is reviewable, provenance-backed, and safe to discard;
- managed support performs approved routine writes while displaying and
  auditing the actual operator;
- a support context cannot bypass, replace, or be confused with a verified
  tenant membership;
- sensitive support operations require distinct authority and evidence;
- tenant-private modules cannot appear in another tenant;
- installation-owned modules can be assigned only within their installation;
- module capabilities cannot exceed manifest, grant, creator, runtime actor,
  and tenant bounds;
- broad data access is explicit, auditable, and brokered without raw credentials;
- broad module reads/writes obey operation/schema allowlists, prohibited-query
  rules, resource limits, expiry, revocation, and adversarial tenant tests;
- owner helpdesk queues work without per-request database fan-out and never use
  projections as authority;
- requesters cannot infer internal-note content, existence, or timing;
- Slack delivery is asynchronous, minimal, escaped, retryable, and tenant-safe;
- Slack actions, when implemented, verify signatures and reauthorise every
  mutation;
- projection tombstones, monotonic updates, lag, reconciliation, retention, and
  helpdesk/managed-support independence are behaviorally proven;
- sensitive reads/exports produce authoritative evidence before returning data;
- evidence and Vanta export cannot cross tenant or connection scope; and
- documentation distinguishes implemented, development-verified, planned, and
  production-approved behavior.

## 20. Alternatives rejected

### Require every client installation to register with an agency console

Rejected because one OpenTenant installation already owns its tenants. A
second registration protocol adds failure modes and implies a global service
that is not part of the reusable template.

### Use identity-provider impersonation for support

Rejected because it obscures the real actor and conflicts with the existing
fail-closed identity gateway. A governed tenant support context provides the
same practical workflow with stronger evidence.

### Query every tenant database for the helpdesk inbox

Rejected as the default because latency and availability degrade with tenant
count. A minimal rebuildable projection avoids fan-out without centralising
ticket content.

### Store all tickets centrally

Rejected because it weakens tenant data-plane ownership, residency, retention,
and deletion boundaries.

### Make all modules use fine-grained table permissions

Rejected because it would couple module contracts to schemas and inhibit useful
development. Business capabilities are the default, with explicit broad access
when justified and narrower constraints where risk requires them.

### Treat Slack or Vanta as a source of truth

Rejected because external delivery and compliance providers can be unavailable,
reconfigured, or disconnected. OpenTenant retains canonical state and evidence.

## 21. Explicit implementation exclusions

This approved design does not itself authorise:

- production enablement or genuine tenant data;
- DNS, live-domain, paid-plan, or provider-resource changes;
- a public Vanta marketplace integration;
- Slack OAuth installation in a real customer workspace;
- provider-native impersonation;
- automatic public AI replies or autonomous ticket resolution;
- direct remote-module database credentials; or
- publication of a tenant-private module to other tenants.

Those actions require their own implementation evidence and, where identified
in [owner tasks](../OWNER-TASKS.md), explicit owner action or decision.
