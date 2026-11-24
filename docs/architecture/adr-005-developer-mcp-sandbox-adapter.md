# ADR-005: Provider-neutral sandbox adapter for tenant module development

Status: Accepted; hosted provider direction updated 2026-07-20

Date: 2026-07-19

Decision owner: Chris

## Context

OpenTenant will let authorised tenant developers and non-technical tenant
administrators use AI coding agents to create new tenant-private modules. The
first delivery priority is the isolated workspace that scaffolds, builds,
tests, and serves a synthetic-data preview. Generated code is untrusted and
must never inherit platform credentials or direct tenant/control-plane access.

OpenFlow is the closest product-level comparison found during research, but
its implementation is an agent/workflow builder on Supabase, Express, Fly.io,
and an in-progress Cloudflare runtime migration. It does not supply the
module-code sandbox, WorkOS authorization, project-per-tenant Neon isolation,
signed remote-module context, or publication controls required here. Forking
it would replace rather than accelerate the existing platform architecture.

sandboxd more directly matches the immediate workspace problem: API-driven
containers, live preview routing, checkpoints, Git operations, and a proxy
that keeps model credentials outside the workspace. Its current beta is
single-server, uses container rather than microVM isolation, and requires
authentication and multi-tenant hardening before it could be a production
security boundary. Vercel Sandbox is the selected hosted target for untrusted
code but introduces provider and commercial dependencies that still require
explicit production gates.

## Decision

OpenTenant remains the control plane. It owns identity, tenant binding,
capability policy, workspace metadata, module lifecycle, publication, and the
canonical audit chain.

Sandbox execution sits behind a provider-neutral `SandboxAdapter`. The first
contract supports:

- create an isolated workspace from an approved template;
- write a bounded set of workspace files;
- execute an allowlisted command with time and output limits;
- start and resolve an authenticated preview;
- checkpoint and restore workspace state;
- retrieve redacted logs and validation artifacts; and
- terminate the workspace and revoke preview access deterministically.

Every adapter is tested with the same conformance suite. The suite treats
tenant identity, resource limits, teardown, secret absence, and stable error
classification as contract behavior rather than provider details.

The initial adapter sequence is:

1. A deterministic in-memory/fake adapter for contract and orchestration tests.
2. A narrow sandboxd feasibility adapter for local/self-hosted development.
3. A narrow Vercel Sandbox feasibility adapter for the hosted pilot.

On 2026-07-20 the owner selected Vercel as the target hosted runtime and
sandbox provider. Production use still requires a separate threat, region,
retention, support, cost, and isolation review. No paid provider plan or live
resource is authorised by this decision.

OpenFlow is a research source, not a base repository or runtime dependency.
OpenTenant may independently implement its execution-event, tenant-cost,
workflow-composition, and MCP-lifecycle patterns. Copying OpenFlow code needs a
separate review of an exact revision covering licence ownership, attribution,
dependencies, security, and maintenance. No code is copied under this ADR.

## Options considered

### Adopt or fork OpenFlow

Rejected. It accelerates visual agent workflows but requires replacement of
the existing identity, database, runtime, module, and deployment boundaries.
It also imports a runtime migration already in progress.

### Build one provider-specific sandbox directly into the Developer MCP

Rejected. It is quicker for the first demo but makes provider lifecycle,
errors, URLs, and credentials part of the product contract and raises future
migration cost.

### Build all sandbox infrastructure in-house

Deferred. It maximises control but spends the first milestone rebuilding
workspace, routing, checkpoint, and lifecycle primitives that can be evaluated
behind an adapter.

### Provider-neutral adapter with targeted provider evaluations

Accepted. It preserves the OpenTenant security and module architecture while
letting the team validate existing sandbox engines quickly and reversibly.

## Security boundary

The foundation milestone uses synthetic data only. Sandboxes receive no
ambient environment variables, reusable database URLs, OAuth tokens, cloud
credentials, signing keys, or control-plane network access. Any future
authenticated outbound call crosses a policy-enforcing broker that injects a
credential outside the sandbox and records the decision on the audit chain.

Container execution alone is not accepted as sufficient isolation for
untrusted production tenants. The production adapter decision must document
kernel isolation, egress enforcement, metadata-service blocking, resource
limits, workspace deletion, preview authorization, incident containment, and
provider revocation behavior.

## Consequences

- Container work can proceed before the full Developer MCP authorization and
  publication surfaces.
- The first code is a contract, fake adapter, and conformance suite rather than
  a provider commitment.
- sandboxd can accelerate local development without becoming the platform
  database, identity provider, or tenant authority.
- Vercel Sandbox can be evaluated for hosted isolation without leaking its SDK
  into module or MCP contracts.
- Supporting two real adapters costs more initially, so the foundation uses
  feasibility probes and promotes only the adapter that passes its decision
  gate.
- WP-D.2 remains a valid deferred workstream and is not coupled to this
  sandbox decision.

## Evidence

- [Developer MCP requirements](../product/developer-mcp.md)
- [OpenFlow repository](https://github.com/daviddominguezh/llm-graph-builder)
- [sandboxd repository](https://github.com/tastyeffectco/sandboxd)
- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)
- [Vercel credential injection](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox)
