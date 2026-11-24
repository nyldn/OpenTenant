# Clerk authentication-provider design

Date: 2026-07-20
Status: browser identity and administration implementation complete; full
development organization/member browser proof and Developer MCP verifier remain
deferred

## 1. Decision

OpenTenant supports Clerk as a complete alternative to WorkOS. Identity is
selected once per deployment:

```text
IDENTITY_PROVIDER=local | workos | clerk
```

One deployment does not mix WorkOS and Clerk tenants. WorkOS remains supported,
and both hosted adapters implement the same provider-neutral application
contracts. The supplied Clerk application, its credentials, organizations,
users, and domains are development/demo resources only. No provider account or
application identifier belongs in tracked source, fixtures, logs, or durable
evidence.

## 2. Goals

- Authenticate browser users with Clerk's native Next.js session lifecycle.
- Map one active Clerk Organization to exactly one OpenTenant tenant.
- Support organization creation/deletion, invitations, memberships, role
  changes, membership removal, logout, and tenant switching through the same
  application behaviors offered by the WorkOS adapter.
- Preserve stable internal user, tenant, and membership identifiers.
- Keep Clerk SDK objects and identifiers inside the Clerk adapter and database
  mapping seams.
- Fail closed for missing, expired, impersonated, unmapped, inactive,
  cross-tenant, unknown-role, and malformed-permission states.
- Provide visible, provider-appropriate sign-in, sign-up, signed-in user, and
  sign-out controls without duplicating the existing WorkOS controls.
- Extend Developer MCP authentication to Clerk in a later vertical slice so
  the completed provider is not browser-only.

## 3. Non-goals

- Selecting identity provider per tenant.
- Running Clerk authentication with WorkOS organization authorization.
- Migrating existing WorkOS users, sessions, organizations, or identifiers.
- Enabling a production Clerk instance, production custom domain, social
  provider, SSO connection, billing feature, or genuine tenant data.
- Treating the demo Clerk application as a repository default.
- Replacing OpenTenant's internal authorization, tenant resolution, audit, or
  row-level-security controls with provider UI decisions.

## 4. Approaches considered

### 4.1 Native Clerk session plus a complete adapter — selected

Clerk middleware owns Clerk cookie/session maintenance. A Clerk port verifies
the opaque session credential and calls Clerk's Backend API for the minimum
organization/user lifecycle operations. `ClerkIdentityGateway` translates the
results into OpenTenant's existing `IdentityGateway` types.

This keeps one browser session, follows Clerk's supported Next.js flow, and
preserves OpenTenant's internal tenant and authorization checks.

### 4.2 Exchange Clerk sessions for an OpenTenant sealed cookie — rejected

This would create two session lifecycles, duplicate refresh/revocation logic,
and risk a valid OpenTenant cookie surviving a revoked Clerk session.

### 4.3 Clerk login with WorkOS authorization — rejected

Cross-provider subject linking and revocation ordering would be ambiguous. It
would not satisfy the requirement that Clerk be a complete alternative.

## 5. Provider-neutral boundaries

### 5.1 Identity provider discriminator

Add a shared `IdentityProvider = "workos" | "clerk"` type. Replace the
WorkOS-only `IdentityAccountLink.provider` type with this discriminator. Every
account, organization, invitation, and membership lookup remains scoped by
provider so identical external strings cannot collide.

`local` remains a development gateway, not an external account-link provider.

### 5.2 Session credential source

The application must not assume every provider uses `opentenant_session`.
Introduce a narrow server-only session-credential source selected at the
composition root:

- WorkOS reads the sealed `opentenant_session` cookie.
- Clerk obtains the current Clerk session credential through its supported
  middleware/server boundary: `await auth()` followed by `await getToken()`.
  The Clerk adapter verifies that opaque token with the supported backend
  verifier, then fetches the referenced session and requires it to remain
  active. It must not use the deprecated `sessions.verifySession` API.
  Application code must not parse a browser cookie or reconstruct a Clerk
  token itself.
- Local identity retains its established development behavior.

The credential remains opaque to the application. Only the chosen gateway
validates it. WorkOS callback handling remains WorkOS-only; Clerk uses its
native session establishment and has no OpenTenant OAuth callback exchange.

### 5.3 Provider administration port

Generalize direct WorkOS organization provisioning behind a neutral
server-only administration port:

```text
createOrganization(name) -> external organization reference
deleteOrganization(reference)
```

The platform tenant route calls this port, records the provider-scoped mapping,
and retains the existing compensating deletion if the local transaction cannot
start. WorkOS and Clerk SDK imports remain in their respective adapter files.

Tenant member administration must also stay provider-neutral. Extend the
gateway boundary with a tenant-scoped member listing that returns internal
`MembershipId` values plus normalized profile, role, and status fields. Member
removal and role changes accept only those internal identifiers and resolve the
provider object inside the selected adapter/store. Platform pages, form values,
responses, and audit details must not expose external membership or
organization identifiers.

Provider-specific account-management UI links are optional capabilities, not
part of the core gateway. The application must render its own membership UI
when a provider has no WorkOS-equivalent hosted Admin Portal intent.

## 6. Clerk adapter

### 6.1 Port responsibilities

The Clerk port owns:

- session-token verification and expiry classification;
- user profile lookup required for stable account linking;
- organization create/delete;
- organization and user membership listing;
- organization invitations and revocation;
- membership deletion and role update;
- session revocation; and
- provider login/sign-out primitives required by the Next.js integration.

Provider responses are treated as hostile. The port returns narrow validated
records, never raw Clerk SDK objects. Errors exposed to callers contain fixed
operation names/status classes and never response bodies, tokens, emails,
provider IDs, or URLs.

### 6.2 Role mapping

The reviewed Clerk-to-OpenTenant role mapping is:

| Clerk organization role | OpenTenant role |
|---|---|
| `org:tenant_owner` | `tenant_owner` |
| `org:tenant_admin` | `tenant_admin` |
| `org:member` | `tenant_member` |

`org:tenant_owner` and `org:tenant_admin` are custom roles in the demo Clerk
application. `org:member` is Clerk's default member role. Any other role grants
no OpenTenant membership and makes the active session invalid for that tenant.
The custom roles must also belong to the application's active Organization Role
Set; creating role records alone is not sufficient. The initial role set uses
`org:tenant_owner` for organization creators and retains `org:member` as its
default member role.

### 6.3 Permission mapping

Clerk custom permission keys use `org:<feature>:<permission>`, while OpenTenant
module permissions use dotted slugs such as `brain.promote`. Do not translate
arbitrary strings mechanically. Maintain an explicit reviewed mapping in the
Clerk adapter, for example:

```text
org:brain:promote -> brain.promote
```

Unknown, system-only, malformed, or unconfigured Clerk permissions are
dropped. A base module-use grant remains membership-derived as it is for
WorkOS; absent custom permissions never broaden access.

### 6.4 Session validation

For a Clerk credential, the gateway:

1. verifies signature, issuer, authorized party/audience where applicable,
   expiry, and session state through the Clerk port;
2. rejects impersonation until a separately audited policy exists;
3. resolves or creates the provider-scoped internal account link;
4. resolves the active Clerk Organization through the control-plane mapping;
5. confirms an active membership for the same subject and organization;
6. maps the exact role and allowlisted custom permissions;
7. compares the mapped tenant with the expected request tenant; and
8. returns only normalized internal identifiers and claims.

An organization claim with no mapping is `tenant_mismatch`, not an org-less
valid session. An expected tenant mismatch is always denied.

### 6.5 Membership lifecycle

- Invitations are idempotent per normalized email and tenant.
- Invitation and accepted-membership references remain distinct so revocation
  cannot target the wrong provider object.
- Removing an unknown internal reference fails loudly instead of silently
  leaving access active.
- Pending invitation roles are changed by revoke-and-reinvite unless Clerk
  exposes an atomic safe update with equivalent semantics.
- Tenant switching trusts only a freshly validated active organization and its
  matching membership.

## 7. Next.js integration

### 7.1 Middleware

Compose `clerkMiddleware()` with the existing host-normalization middleware;
do not replace the host and `x-opentenant-*` stripping logic. Clerk behavior is
active only when `IDENTITY_PROVIDER=clerk`.

For Next.js 15, retain `apps/platform/middleware.ts`. Its matcher must include
the broad application matcher plus these entries exactly once, with the Clerk
path after the API matcher:

```text
/(api|trpc)(.*)
/__clerk/:path*
```

Routes remain public by default. Authorization continues close to each
resource through `currentSession()`, tenant binding, roles, and permissions.

### 7.2 Provider and controls

When Clerk is selected, render `ClerkProvider` inside `<body>` and expose
natural sign-in, sign-up, signed-in user, and sign-out controls using
`@clerk/nextjs`. When WorkOS or local identity is selected, do not initialize
Clerk UI or require Clerk environment variables.

The existing anonymous tenant landing remains branded. Clerk controls replace
only its authentication actions. The existing WorkOS login/callback/logout
routes remain functional for WorkOS deployments and fail closed or redirect to
the provider-appropriate flow when Clerk is selected.

### 7.3 Configuration

Development uses ignored runtime values only:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Any additional issuer, sign-in URL, or authorized-party configuration must be
derived from official Clerk configuration or supplied through environment
variables. The demo application ID is CLI-local metadata and is never committed.
`CLERK_SECRET_KEY` is server-only and must never appear in client code, logs,
tests, tracked examples, or provider error messages.

## 8. Developer MCP

The existing provider-neutral Developer MCP authentication contract stays
unchanged. Add a Clerk verifier in a later slice that:

- verifies exact Clerk issuer and intended OpenTenant audience;
- requires a mapped organization and active tenant binding;
- rejects impersonation, delegated ambiguity, org-less tokens, unknown roles,
  malformed permissions, and cross-tenant claims; and
- emits the same normalized principal as the WorkOS verifier.

No successful Clerk Developer MCP tool route is exposed until its schema,
permissions, group/role mapping, and launch authorization decisions are
approved independently.

## 9. Test strategy

### 9.1 Behavioral contract tests

Extract reusable identity-gateway conformance cases and run them against fake
WorkOS and Clerk ports. Cover:

- valid org-bound session;
- anonymous, invalid, and expired credentials;
- impersonation;
- unmapped organization;
- inactive/missing membership;
- unknown role and permission;
- expected-tenant mismatch;
- provider-scoped account-link collision prevention;
- invitation idempotency and invitation/member distinction;
- remove, role change, and logout;
- provider create compensation; and
- provider error redaction.

### 9.2 Next.js behavior

- WorkOS and local deployments build without Clerk keys.
- Clerk deployment requires both Clerk keys and never exposes the secret.
- Middleware retains malformed-host denial and strips all inbound
  `x-opentenant-*` headers.
- The matcher contains the Clerk path exactly once.
- Signed-out users see sign-in and sign-up; signed-in users see their identity
  and sign-out control.
- WorkOS callback/session regression coverage remains green.

### 9.3 Demo runtime proof

Against the owner-supplied test Clerk application only:

1. configure the two custom roles and required custom permissions;
2. create one uniquely named synthetic organization/user/membership;
3. map it to a temporary local tenant;
4. complete browser sign-up/sign-in and active-organization selection;
5. prove exact role, permission, tenant binding, and logout/revocation;
6. remove only resources created by the probe; and
7. record sanitized zero-residue or provider-retention evidence.

Do not use genuine tenant data, reconfigure live domains, enable production, or
retain provider identifiers in repository evidence.

## 10. Delivery slices

Current status: slices 1–4 are complete. Slice 5 remains deferred until the
Developer MCP permissions and schemas are approved. Slice 6 has completed
configuration, signed-out browser, and hosted sign-in-surface evidence; the
synthetic organization/member flow remains owner-gated by the final Clerk
custom-role permission decision.

1. **Neutralize provider-scoped types and composition.** Add provider
   discriminator, neutral administration port, provider-aware resolver/store,
   and shared conformance harness without changing WorkOS behavior.
2. **Clerk gateway and SDK port.** Implement sessions, organization/member
   lifecycle, role/permission mapping, and provider-redaction tests.
3. **Next.js Clerk runtime.** Compose middleware, provider, session source, and
   visible auth controls while preserving WorkOS/local builds.
4. **Tenant provisioning and administration parity.** Use the neutral admin
   port and prove compensation/member-management behavior.
5. **Clerk Developer MCP verifier.** Implement only after its separate
   permission/schema decisions are approved.
6. **Live demo proof and documentation.** Configure and exercise temporary test
   resources, clean them up, run full gates, and refresh Graphify.

Each slice follows RED, verified RED, GREEN, focused regression checks, runtime
evidence where applicable, independent review, durable-ledger update, and a
local checkpoint commit.

## 11. Acceptance criteria

- A deployment chooses exactly one of local, WorkOS, or Clerk identity.
- WorkOS and local regression behavior is unchanged.
- Clerk implements every `IdentityGateway` lifecycle method and tenant
  organization provisioning needed by current platform routes.
- Canonical roles and explicitly mapped module permissions behave identically
  across WorkOS and Clerk.
- All ambiguous tenant, membership, role, permission, and provider states fail
  closed.
- Provider SDK imports remain inside their adapter/composition boundaries.
- No Clerk credential, application/instance ID, organization/user/membership
  ID, provider URL, or genuine tenant data enters tracked source or evidence.
- The complete repository validation, production build, current runtime smoke,
  and Graphify integrity checks pass before the provider is described as
  implemented.
- The full organization/member browser flow and cleanup readback pass before a
  Clerk installation is described as production-ready.

## 12. References

- [Clerk Next.js App Router quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart)
- [Clerk Organizations](https://clerk.com/docs/guides/organizations/overview)
- [Clerk roles and permissions](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)
- [Clerk Backend API](https://clerk.com/docs/reference/backend-api)
- [Clerk CLI](https://clerk.com/docs/cli)
