# Developer MCP local operation

Status: implemented, disabled pending OWNER-DEVELOPER-MCP-02 approval.
No deployed configuration is enabled. Reconciled 2026-11-17: the earlier stub
PostgreSQL suite is now supplemented by the
[real local route receipt](../reviews/2026-11-17-developer-mcp-route.json).
It proves OAuth/PKCE, tenant authority, human confirmation, actual VM execution
and destruction before static preview, plus negative controls. The separate
[provider proof](../reviews/2026-11-14-real-sandbox-smtp-proofs.md) has a
different scope. Neither is a hosted or production receipt. Marketing impact: none.

`/api/mcp/developer` implements stateless MCP `2026-07-28` discovery, listing and
one tool, `workspace.create`. The only registered template is
`opentenant/module-service@1`. It writes synthetic server-owned module and HTML
files, runs bounded `node --check`, collects the exact approved HTML, and tears
down the workspace. The returned preview is a static snapshot, not a running
application or publication. UI templates, arbitrary code execution, Git,
external API access and publication are not enabled.

## Configuration and owner approval

The MCP-specific server validator is `app/api/mcp/server-config.ts`, backed by
`developerMcpConfig` in the authority package. It reads the shared server-config
snapshot, not request metadata. Defaults are off. Invalid flag strings fail.

| Setting | Meaning |
| --- | --- |
| `DEVELOPER_MCP_ENABLED` | Exact `true` enables local composition. Default `false`. |
| `DEVELOPER_MCP_OWNER_APPROVED_ROUTE` | Production requires the exact value `/api/mcp/developer`. This records OWNER-DEVELOPER-MCP-02, not a general deployment approval. |
| `DEVELOPER_MCP_RESOURCE_URL` | Exact HTTPS URL, or loopback HTTP outside production, ending in `/api/mcp/developer`, without credentials, query or fragment. Never inferred from Host. |
| `DEVELOPER_MCP_AUTHORIZATION_SERVER` | Explicit issuer identity for protected-resource metadata; loopback HTTP is allowed outside production. |
| `SANDBOX_PROVIDER` | The application composition supports `microsandbox` only. |
| `DEVELOPER_MCP_LOCAL_IMAGE` | Installation-reviewed image ending in `@sha256:<64 lowercase hex>`, already cached locally. No image pull. |

Keep these settings absent in deployed configuration until the owner approves
the exact route and its evidence. A feature flag cannot grant tenant authority.
Production enablement without the exact approval throws before request handling.
The global server configuration invokes this validator during startup.

## Local authority and confirmation

The local authority store accepts only opaque access-token handles whose SHA-256
hash, exact resource audience, expiry and revocation state are stored in
`developer_mcp.tokens`. No raw bearer token is persisted. Projects bind an exact
tenant, user, registered client, immutable profile version and consent scope
set. Token scopes, profile and consent intersect using the frozen authority
library. Active tenant, project and identity-provider membership state are rechecked for every call. Membership removal independently denies even if the local token and project remain active. The local code/PKCE issuer below uses this opaque-token verifier. Token issuance
requires an authenticated local or Better Auth browser session, exact registered
client redirect and explicit project consent. No hosted OAuth adapter is enabled.

Only trusted installation code may seed synthetic projects and short-lived local
token records. `DeveloperMcpStore.confirm` accepts an already authenticated human
bound to the same tenant and user. A trusted review controller must call it after
showing the exact template and label to that human. MCP itself cannot issue a
confirmation. The returned secret is sent in `X-OpenTenant-Confirmation` and
consumed once, bound to tenant/user/client/project/tool/input digest and expiry.
The integrated browser confirmation form is described below. The real route
proof automates explicit consent and confirmation with synthetic human identities.

Calls require JSON and event-stream Accept headers, mirrored
`MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, and `Mcp-Name: workspace.create`
for tool calls. Each request carries the protocol version and client-capabilities
metadata. Tool arguments contain only `templateId` and `label`. Supply an
`Idempotency-Key` of 16–128 ASCII letters, digits, underscores or hyphens.
Duplicate keys do not execute again. Unknown methods, slugs, tenant metadata,
foreign resources, expired tokens and unavailable storage deny.

The configured resource URL plus `?metadata` publishes protected-resource
metadata only while enabled. Unauthorized responses advertise that exact URL.
The initial isolated route change did not install root well-known aliases.
The integrated discovery paths are listed below.

## Limits, switches, jobs and audit

Creation and exchange also require the explicit `module.dev.preview.open` scope.

Both durable switches must exist and be true: `installation` and
`tenant:<tenant-id>`. Missing state denies. `DeveloperMcpStore.setSwitch` is an
installation-owner boundary; it commits changes with their audit event. A tenant
switch cannot override an installation denial. Module health grants nothing.

Admission uses `PgAdmissionStore`: ten calls per minute, one concurrent call per
user and tenant, 8 KiB maximum request, a forty-second lease, bounded idempotency
retention, and twenty local jobs per tenant per hour. The local execution budget
permits no hosted spend. VM limits are one CPU, 256 MiB, thirty seconds, five
seconds per command and bounded files/output. Jobs expire at the earliest token,
admission and freshness deadline. A watchdog terminates the VM on deadline or
failed live authority/switch checks. Failure withholds previews and records a
failed job. No ambient environment or provider credential is passed to the VM;
the microsandbox adapter disables its NIC and runs commands with an empty env.
The real route receipt checks guest environment/mounts, denied public/host
egress, secret absence and VM destruction. Its cached-image local proof does
not approve a production provider; stub conformance alone is insufficient.

Authorization records retain the frozen v2 fields and their digest chain inside
the existing hash-chained `audit_events`. Admission, confirmation consumption,
job creation and authorization evidence use durable state. Confirmation use,
job creation and audit commit in one transaction. Admission leases are reserved
separately and released in `finally`; no transaction claims to atomically commit
a remote VM operation. Tool output contains no process stdout, raw provider URL,
token or provider error.

Preview exchange is POST `/api/mcp/developer/preview`, with the bearer token,
exact configured Origin, and `X-OpenTenant-Preview` from the tool result. It
rechecks tenant/user/client/project, active authority, switch, job status and
expiry. Each handle exchanges once. The HTML uses no-store, restrictive CSP,
sandbox, no scripts, no framing and no referrers. It never redirects to a raw
sandbox origin. It is bounded synthetic content, not tenant or generated HTML.

## Integration ownership handoff

The shared migration, startup, package, CI, OAuth and browser work is integrated
below. Production owner approval and hosted CI receipts remain open.

## Integrated local flow

Canonical control-plane migrations 0070 and 0071 install runtime and OAuth
storage. Global startup validates the owner gate. Runtime imports consume built
package entrypoints. CI runs the Developer MCP and Brain suites with exact test
counts and rejects skipped cases. Brain registers its route through its manifest
and receives scoped host ports, including the declared execution mode.

With local or Better Auth identity, register a client with one exact HTTPS or
loopback redirect in `developer_mcp.oauth_clients`, an active tenant/user/client
project, its consented scopes, and both owner-controlled switches. No request
creates these grants. Discover `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/api/mcp/developer`. The authorization form
requires the matching live browser session and explicit approval. Only code plus
S256 PKCE is supported. Codes expire in 60 seconds and exchange once for an
opaque audience-bound token lasting five minutes. Token exchange rechecks live
membership, the project and kill switches. Static registration is intentional;
there is no public dynamic client-registration endpoint.

Before a mutating `workspace.create` call, open `/api/mcp/developer/confirm` in
the authenticated tenant browser, enter the assigned project and workspace label,
and explicitly confirm. The returned one-use handle binds tenant, user, client,
project, tool and input for at most 60 seconds. Send it only in
`X-OpenTenant-Confirmation`. Cross-origin submissions and foreign projects deny.
No tool output can approve itself. Browser tests cover the consent and PKCE flow
and confirmation form; database tests cover expiry, replay, rollback and revocation.

Production enablement remains rejected without OWNER-DEVELOPER-MCP-02 approval.
Real local microsandbox credential and network isolation are established by the
Nov 17 route proof with its cached digest-pinned image. Hosted model validation
and production sandbox approval remain absent. GitHub Actions is billing-blocked;
OWNER-KVM-CI-01 still requires an approved runner and actual hosted proof.

## Verification

The committed package receipt is 141 Developer MCP tests with zero skips,
recorded in commits `7dd2d33` and `a3d72f0`. This package count is separate
from the single real route proof and two focused browser cases. See the
[E11 evidence ledger](../plans/2026-11-17-e11-reconciliation.md) for current
database and collection counts; they are not new runs performed by E11.

Run the authority and Brain PostgreSQL suites without skips:

```sh
pnpm db:ephemeral -- pnpm --filter @opentenant/developer-mcp test
pnpm db:ephemeral -- pnpm --filter @opentenant/brain test
pnpm db:ephemeral -- pnpm rls:proof
```

The Brain PostgreSQL suite is `packages/developer-mcp/src/brain.integration.test.ts`
so it can use the owned runtime package's pg dependency without editing Brain's
package manifest. It applies the canonical tenant core/module migrations, uses
`tenant_app` with transaction-local RLS and queries the real vector operator.
Search resolves the tenant's `brain` / `embedding` / `primary` model route before
embedding input. Local model `local/token-hash-v1` must be in the reviewed
allowlist and tenant selection. Hosted adapters are absent by default and must
be explicitly composed with approved credentials and region handling. Production
has no implicit local or hosted embedding fallback.
