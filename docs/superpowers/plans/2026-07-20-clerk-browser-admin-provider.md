# Clerk Browser and Administration Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Clerk as a complete per-deployment browser identity and tenant-administration alternative while preserving WorkOS and local identity behavior.

**Architecture:** The deployment selects `local`, `workos`, or `clerk` once at the server composition root. Provider identifiers stay inside provider-bound stores and adapters; platform routes use internal user, tenant, and membership identifiers. Clerk middleware establishes the native browser session, `auth().getToken()` supplies an opaque credential, and the Clerk adapter verifies the token plus authoritative active-session state before returning OpenTenant claims.

**Tech Stack:** TypeScript, Next.js 15.5 App Router, `@clerk/nextjs` 7.5.20, `@clerk/backend` 3.11.7, PostgreSQL 17, Vitest, pnpm 11.13.1, Node.js 22.

---

## Scope and exclusions

This plan implements design slices 1–4 from `docs/superpowers/specs/2026-07-20-clerk-auth-provider-design.md`. A separate plan covers the Clerk Developer MCP verifier. Live provider setup and browser proof happen only after this plan passes local checks and remain restricted to the owner-supplied demo application.

No task in this plan changes DNS, production configuration, paid capacity, Vercel resources, Neon resources, WorkOS resources, or genuine tenant data. No task reads or prints `.env` files.

## File responsibility map

- `packages/auth/src/provider-store.ts`: provider-neutral persistence contracts for external identity references.
- `packages/auth/src/identity.ts`: normalized identity/session/member contracts only.
- `packages/auth/src/clerk/{port,gateway,sdk}.ts`: Clerk-only records, mapping, and Backend API boundary.
- `packages/database/src/control-plane-stores.ts`: provider-bound PostgreSQL implementations.
- `apps/platform/lib/identity.ts`: exhaustive per-deployment composition and organization provisioner.
- `apps/platform/lib/session.ts`: provider-selected opaque credential source and expected-tenant validation.
- `apps/platform/middleware.ts`: host/header security composed with Clerk middleware.
- `apps/platform/app/auth-controls.tsx`: Clerk client controls; no secret-bearing code.
- platform auth/settings/admin routes: provider-neutral behavior and internal identifiers only.

### Task 1: Provider-scoped neutral persistence

**Files:**
- Create: `packages/auth/src/provider-store.ts`
- Modify: `packages/auth/src/identity.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/auth/src/workos/gateway.ts`
- Modify: `packages/database/src/control-plane-stores.ts`
- Test: `packages/database/src/control-plane-stores.test.ts`
- Modify: `packages/platform-core/src/tenant.ts`
- Modify: `packages/platform-core/src/repositories.ts`

- [x] **Step 1: Write failing provider-isolation tests**

Add database-store tests that construct both providers and assert every identity SQL statement binds the provider as a parameter. The observable assertions are:

```ts
const workos = new PgTenantOrgResolver(pool, "workos");
const clerk = new PgTenantOrgResolver(pool, "clerk");

await workos.tenantForExternalOrganization("external_same");
await clerk.tenantForExternalOrganization("external_same");

expect(query).toHaveBeenNthCalledWith(
  1,
  expect.stringContaining("provider = $1"),
  ["workos", "external_same"],
);
expect(query).toHaveBeenNthCalledWith(
  2,
  expect.stringContaining("provider = $1"),
  ["clerk", "external_same"],
);
```

Add the same collision proof for account links and membership links. Use only `example.test` profiles and synthetic references.

- [x] **Step 2: Verify RED**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/database test -- control-plane-stores.test.ts
```

Expected: failure because the constructors do not accept a provider and SQL hard-codes `workos`.

- [x] **Step 3: Add the neutral contracts**

Create `provider-store.ts` with these complete public shapes:

```ts
import type { IdentityProvider, MembershipId, TenantId, UserId } from "./identity";

export interface TenantOrgResolver {
  tenantForExternalOrganization(externalOrganizationId: string): Promise<TenantId | null>;
  externalOrganizationForTenant(tenantId: TenantId): Promise<string | null>;
}

export type ExternalMembershipRef =
  | { kind: "membership"; externalId: string; tenantId: TenantId; userId: UserId }
  | { kind: "invitation"; externalId: string; tenantId: TenantId; userId: null };

export interface AccountLinkStore {
  readonly provider: IdentityProvider;
  userIdForExternalSubject(
    externalSubject: string,
    email: string,
    displayName: string | null,
  ): Promise<UserId>;
  externalSubjectForUserId(userId: UserId): Promise<string | null>;
  membershipIdForExternalRef(
    ref: Pick<ExternalMembershipRef, "kind" | "externalId">,
    context: { tenantId: TenantId; userId: UserId | null },
  ): Promise<MembershipId>;
  externalRefForMembershipId(membershipId: MembershipId): Promise<ExternalMembershipRef | null>;
  isPlatformAdmin(userId: UserId): Promise<boolean>;
}
```

In `identity.ts`, add:

```ts
export type IdentityProvider = "workos" | "clerk";
```

and change `IdentityAccountLink.provider` to `IdentityProvider`. Move the three persistence contracts out of the WorkOS gateway and re-export them from `index.ts`.

Use that same `IdentityProvider` in `packages/platform-core/src/tenant.ts` for
`IdentityOrgMapping.provider` and in `repositories.ts` for
`getByExternalOrganization(provider, externalOrganizationId)`. This public
control-plane model must not retain a WorkOS-only discriminator.

- [x] **Step 4: Parameterize PostgreSQL stores**

Bind each store instance to one provider:

```ts
export class PgTenantOrgResolver implements TenantOrgResolver {
  constructor(
    private readonly pool: Pool,
    private readonly provider: IdentityProvider,
  ) {}
}

export class PgAccountLinkStore implements AccountLinkStore {
  constructor(
    private readonly pool: Pool,
    readonly provider: IdentityProvider,
  ) {}
}
```

Replace every embedded `'workos'` literal in these classes with `$1` and shift the remaining parameters. `externalRefForMembershipId()` must select `tenant_id` and `user_id`, reject a membership row missing either owner, and return the full `ExternalMembershipRef`. The schema already has provider-composite keys, so do not add a migration.

- [x] **Step 5: Verify GREEN and regress WorkOS**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/database test
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth test
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/database typecheck
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth typecheck
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/platform-core typecheck
```

Expected: all commands exit 0; provider-collision cases pass; existing ownership tests remain green.

- [x] **Step 6: Checkpoint**

```bash
git add packages/auth/src/provider-store.ts packages/auth/src/identity.ts packages/auth/src/index.ts packages/auth/src/workos/gateway.ts packages/database/src/control-plane-stores.ts packages/database/src/control-plane-stores.test.ts packages/platform-core/src/tenant.ts packages/platform-core/src/repositories.ts
git diff --cached --check
git commit -m "refactor: scope identity stores by provider"
```

### Task 2: Normalize tenant-member administration

**Files:**
- Modify: `packages/auth/src/identity.ts`
- Modify: `packages/auth/src/workos/port.ts`
- Modify: `packages/auth/src/workos/sdk.ts`
- Modify: `packages/auth/src/workos/gateway.ts`
- Modify: `packages/auth/src/local/gateway.ts`
- Test: `packages/auth/src/workos/gateway.test.ts`
- Test: `packages/auth/src/local/gateway.test.ts`

- [x] **Step 1: Write failing normalized-member tests**

Add WorkOS gateway cases proving `listTenantMembers(tenantId)` returns only internal identifiers:

```ts
await expect(gateway.listTenantMembers(tenantA)).resolves.toEqual([
  {
    kind: "membership",
    membershipId: internalMembershipId,
    userId: internalUserId,
    tenantId: tenantA,
    email: "member@example.test",
    displayName: "Member Example",
    role: "tenant_owner",
    status: "active",
  },
]);
```

Also prove unknown roles are omitted, invitation records carry `userId: null`, removal uses the stored tenant owner, and audit-facing records contain no external reference. Add a local-gateway case returning its single synthetic member.

- [x] **Step 2: Verify RED**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth test -- gateway.test.ts
```

Expected: TypeScript/test failure because `listTenantMembers` and the normalized record do not exist.

- [x] **Step 3: Extend the neutral gateway**

Add to `identity.ts`:

```ts
export interface TenantMember {
  kind: "membership" | "invitation";
  membershipId: MembershipId;
  userId: UserId | null;
  tenantId: TenantId;
  email: string;
  displayName: string | null;
  role: TenantRole;
  status: "active" | "invited" | "suspended";
}
```

Add `listTenantMembers(tenantId: TenantId): Promise<TenantMember[]>` to `IdentityGateway`. Implement it in WorkOS through the port, mapping external subjects/references inside the adapter. Implement the local method with the established local user.

Replace the positional login method with one request-context object so every
provider has the same unambiguous contract:

```ts
export interface LoginRequest {
  tenantId: TenantId | null;
  returnPath: string;
  requestUrl: string;
}

startLogin(request: LoginRequest): Promise<URL>;
```

WorkOS uses `tenantId` and `returnPath`; local identity keeps its configured
loopback origin; Clerk uses the origin of the validated `requestUrl` and the
sanitized return path. Update WorkOS/local gateway tests in this task so no
call site can accidentally pass the request URL as the return path.

Update provider port method signatures so revoke/update operations receive the external organization reference and the adapter can prove tenant ownership. Pending invitation role changes call a port operation that reads the invitation, revokes it, and sends a replacement with the requested mapped role.

- [x] **Step 4: Make WorkOS invitation creation idempotent**

At the WorkOS SDK boundary, normalize email with `trim().toLowerCase()`, list pending invitations for the organization, and reuse the matching invitation ID. Only call `sendInvitation` when no pending match exists. Return fixed errors such as `WorkOS invitation operation failed`; never propagate provider response bodies.

- [x] **Step 5: Verify GREEN**

Run the full auth test/typecheck commands from Task 1. Expected: all pass and the WorkOS adapter still satisfies every existing session and membership behavior.

- [x] **Step 6: Checkpoint**

```bash
git add packages/auth/src/identity.ts packages/auth/src/workos packages/auth/src/local
git diff --cached --check
git commit -m "refactor: normalize identity member administration"
```

### Task 3: Implement the Clerk gateway test-first

**Files:**
- Create: `packages/auth/src/clerk/port.ts`
- Create: `packages/auth/src/clerk/gateway.ts`
- Create: `packages/auth/src/clerk/gateway.test.ts`
- Create: `packages/auth/src/testing/gateway-conformance.ts`
- Modify: `packages/auth/src/workos/gateway.test.ts`
- Modify: `packages/auth/src/index.ts`

- [x] **Step 1: Write the fake Clerk port and failing behavior suite**

The fake port must model authenticated, expired, invalid, impersonated, inactive-session, missing-membership, invitation, membership, update, removal, and logout outcomes. Run the same exported conformance cases against WorkOS and Clerk factories. Add Clerk-specific assertions for:

```ts
expect(roleFromClerk("org:tenant_owner")).toBe("tenant_owner");
expect(roleFromClerk("org:tenant_admin")).toBe("tenant_admin");
expect(roleFromClerk("org:member")).toBe("tenant_member");
expect(roleFromClerk("org:admin")).toBeNull();
expect(modulePermissionsFromClerk([
  "org:brain:promote",
  "org:sys_memberships:manage",
  "org:unknown:grant",
])).toEqual(["brain.promote"]);
```

Tests must also prove an organization claim without a mapping returns `tenant_mismatch`, active-org mismatch is denied, cross-provider identical external strings do not collide, and no provider error text escapes.

- [x] **Step 2: Verify RED**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth test -- clerk/gateway.test.ts
```

Expected: failure because the Clerk modules do not exist.

- [x] **Step 3: Define the narrow Clerk port**

Use validated records only:

```ts
export interface ClerkAuthenticatedSession {
  externalSessionId: string;
  externalSubject: string;
  externalOrganizationId: string | null;
  email: string;
  displayName: string | null;
  impersonated: boolean;
  role: string | null;
  permissions: string[];
  expiresAt: Date;
}

export type ClerkSessionResult =
  | { status: "authenticated"; session: ClerkAuthenticatedSession }
  | { status: "expired" }
  | { status: "invalid" };
```

`ClerkPort` exposes session authentication, organization create/delete, user/organization membership reads, invitation list/create/revoke/replace, membership delete/update, and session revoke. Every operation accepts enough organization context to prove ownership. Clerk membership update/delete uses `(externalOrganizationId, externalSubject)`, matching the Backend API's `{ organizationId, userId }` key; it never attempts a mutation by Clerk membership ID alone.

- [x] **Step 4: Implement the gateway**

Mirror the WorkOS gateway control flow, but use only these exact maps:

```ts
const ROLE_FROM_CLERK = {
  "org:tenant_owner": "tenant_owner",
  "org:tenant_admin": "tenant_admin",
  "org:member": "tenant_member",
} as const;

const PERMISSION_FROM_CLERK: Readonly<Record<string, string>> = {
  "org:brain:promote": "brain.promote",
};
```

Require the authoritative port session to be active, reject `actor`/impersonation, confirm the same active organization and membership, resolve the tenant mapping, compare the expected tenant, and return only normalized claims. Before a membership update or delete, resolve the stored internal tenant through `TenantOrgResolver`, resolve the stored internal user through `AccountLinkStore`, list the target organization, and require one record whose organization, external subject, and stored external membership ID all match. A missing or ambiguous match fails before mutation. `startLogin` consumes the full `LoginRequest` and produces a same-origin `/sign-in` URL with the sanitized return path. `logout` revokes the external session derived from the verified token.

- [x] **Step 5: Verify GREEN and conformance**

Run the auth test/typecheck suite. Expected: Clerk and WorkOS pass the shared cases; Clerk-specific mapping and fail-closed cases pass.

- [x] **Step 6: Checkpoint**

```bash
git add packages/auth/src/clerk packages/auth/src/testing packages/auth/src/workos/gateway.test.ts packages/auth/src/index.ts
git diff --cached --check
git commit -m "feat: add Clerk identity gateway"
```

### Task 4: Implement the Clerk Backend API boundary

**Files:**
- Create: `packages/auth/src/clerk/sdk.ts`
- Create: `packages/auth/src/clerk/sdk.test.ts`
- Modify: `packages/auth/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/auth/src/index.ts`

- [x] **Step 1: Add the direct backend dependency**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth add @clerk/backend@3.11.7
```

Keep the already installed `@clerk/nextjs` dependency in `apps/platform`. Do not import backend types through a transitive dependency.

- [x] **Step 2: Write failing SDK tests**

Mock `verifyToken` and `createClerkClient` at the module boundary. Cover exact audience/authorized-party options, an exact post-verification `iss` comparison against configured expected issuer, subject/session/org claim validation, active-session readback, profile normalization, role and custom-permission extraction, idempotent invitation reuse, organization-scoped update/delete, invalid provider objects, and fixed error messages. Include a test whose mock provider error contains a synthetic secret and assert it is absent from the thrown message. Paginated membership and invitation mocks must place the matching record on page two so the test fails if only the default page is read.

- [x] **Step 3: Verify RED**

Run:

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm --filter @opentenant/auth test -- clerk/sdk.test.ts
```

Expected: failure because `createClerkPort` and `clerkConfigFromEnv` do not exist.

- [x] **Step 4: Implement safe configuration and SDK translation**

Use this server-only config shape:

```ts
export interface ClerkSdkConfig {
  secretKey: string;
  publishableKey: string;
  issuer: string;
  authorizedParties: string[];
  audience?: string[];
}
```

`clerkConfigFromEnv()` requires both keys, an expected Clerk issuer, and an explicit comma-separated authorized-party list; it accepts an optional audience list, validates HTTPS origins outside loopback development, and never includes values in errors. After `verifyToken()`, compare `payload.iss` exactly with the configured issuer because `verifyToken` has no issuer option. `authenticateSession()` then calls `client.sessions.getSession(sessionId)` and requires status `active`. Do not call deprecated `sessions.verifySession`.

Fetch membership and invitation lists with `limit: 100` and increasing
`offset`. Continue until the returned data reaches `totalCount`; reject
inconsistent pagination and more than 10,000 records with a fixed operation
error. Validate every ID, role, permission, email, pagination result, and URL
before returning a narrow record.

- [x] **Step 5: Verify GREEN**

Run auth tests, typecheck, lint, and `pnpm install --offline --frozen-lockfile`. Expected: all exit 0.

- [x] **Step 6: Checkpoint**

```bash
git add packages/auth/src/clerk packages/auth/src/index.ts packages/auth/package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "feat: add Clerk backend adapter"
```

### Task 5: Compose Clerk request sessions and middleware

**Files:**
- Modify: `apps/platform/lib/identity.ts`
- Modify: `apps/platform/lib/session.ts`
- Create: `apps/platform/lib/session.test.ts`
- Modify: `apps/platform/middleware.ts`
- Create: `apps/platform/middleware.test.ts`
- Modify: `apps/platform/app/assessment/layout.tsx`
- Modify: `apps/platform/app/page.tsx`
- Modify: `apps/platform/lib/tenant-admin.ts`
- Modify: `apps/platform/lib/support.ts`
- Modify: `apps/platform/app/m/[module]/[[...path]]/route.ts`

- [x] **Step 1: Write failing composition and security tests**

Test an exhaustive selector:

```ts
expect(identityProviderFromEnv({ IDENTITY_PROVIDER: "local" })).toBe("local");
expect(identityProviderFromEnv({ IDENTITY_PROVIDER: "workos" })).toBe("workos");
expect(identityProviderFromEnv({ IDENTITY_PROVIDER: "clerk" })).toBe("clerk");
expect(() => identityProviderFromEnv({ IDENTITY_PROVIDER: "other" })).toThrow(
  "Unsupported IDENTITY_PROVIDER",
);
```

Mock `cookies()` and Clerk `auth()` to prove WorkOS/local read only `opentenant_session`, Clerk calls `await auth()` then `await getToken()`, anonymous Clerk returns null, and `currentSession(expectedTenantId)` passes the exact expected tenant to the selected gateway.

Middleware tests must preserve malformed-host 404 and complete `x-opentenant-*` stripping for all providers. Inspect `config.matcher` and assert `/(api|trpc)(.*)` precedes one `/__clerk/:path*` entry.

- [x] **Step 2: Verify RED**

Run the focused platform tests. Expected: selector/session/middleware cases fail because only local-versus-WorkOS composition exists.

- [x] **Step 3: Implement exhaustive composition**

In `apps/platform/lib/identity.ts`, export:

```ts
export type DeploymentIdentityProvider = "local" | IdentityProvider;

export function identityProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentIdentityProvider {
  const value = env.IDENTITY_PROVIDER;
  if (value === "local" || value === "workos" || value === "clerk") return value;
  throw new Error("Unsupported IDENTITY_PROVIDER");
}
```

Construct provider-bound stores with the selected external provider. Never default an unknown or missing value to WorkOS. Add `usesClerkIdentity()` and a neutral `identityOrganizationPort()` for create/delete.

- [x] **Step 4: Implement the credential source**

In `session.ts`, keep provider code server-only:

```ts
async function sessionCredential(): Promise<string | null> {
  if (!usesClerkIdentity()) {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  }
  const clerk = await auth();
  if (!clerk.isAuthenticated) return null;
  return clerk.getToken();
}

export async function currentSession(
  expectedTenantId: TenantId | null = null,
): Promise<IdentitySession | null> {
  const credential = await sessionCredential();
  if (!credential) return null;
  const result = await identityGateway().validateSession(credential, expectedTenantId);
  return result.status === "valid" ? result.session : null;
}
```

Import `auth` from `@clerk/nextjs/server`; never import it from the package
root, where this installed version deliberately types it as `never`.

Update every tenant-sensitive caller to pass the resolved tenant ID:
`app/page.tsx`, `app/assessment/layout.tsx`, `lib/tenant-admin.ts`,
`lib/support.ts`, and `app/m/[module]/[[...path]]/route.ts`. Platform-admin
surfaces may pass null. The tests must prove the home page does not treat a
valid session for another tenant as authenticated workspace access.

- [x] **Step 5: Compose middleware without weakening host security**

Extract the current function as `hostSecurityMiddleware(request)`. Export one Next middleware entry that invokes it directly unless Clerk is selected; for Clerk, invoke it as the callback result of `clerkMiddleware()`. Keep routes public by default and retain resource-level authorization.

Import `clerkMiddleware` from `@clerk/nextjs/server`, not from the package
root. Cache the constructed Clerk middleware handler without evaluating Clerk
configuration on WorkOS/local request paths.

Use exactly:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
```

- [x] **Step 6: Verify GREEN**

Run platform tests/typecheck. Then run local and WorkOS production builds with Clerk keys absent from the command environment. Expected: tests and both builds exit 0.

- [x] **Step 7: Checkpoint**

```bash
git add apps/platform/lib/identity.ts apps/platform/lib/session.ts apps/platform/lib/session.test.ts apps/platform/middleware.ts apps/platform/middleware.test.ts apps/platform/app/assessment/layout.tsx apps/platform/app/page.tsx apps/platform/lib/tenant-admin.ts apps/platform/lib/support.ts 'apps/platform/app/m/[module]/[[...path]]/route.ts'
git diff --cached --check
git commit -m "feat: compose Clerk request authentication"
```

### Task 6: Add provider-appropriate auth controls and routes

**Files:**
- Create: `apps/platform/app/auth-controls.tsx`
- Create: `apps/platform/app/sign-in/[[...sign-in]]/page.tsx`
- Create: `apps/platform/app/sign-up/[[...sign-up]]/page.tsx`
- Modify: `apps/platform/app/layout.tsx`
- Modify: `apps/platform/app/page.tsx`
- Modify: `apps/platform/app/auth/login/route.ts`
- Modify: `apps/platform/app/auth/callback/route.ts`
- Modify: `apps/platform/app/auth/logout/route.ts`
- Test: `apps/platform/app/auth/login/route.test.ts`
- Test: `apps/platform/app/auth/callback/route.test.ts`
- Test: `apps/platform/app/auth/logout/route.test.ts`

- [x] **Step 1: Write failing route-dispatch tests**

Prove local/WorkOS login behavior stays unchanged, Clerk login redirects only to same-origin `/sign-in`, WorkOS callback returns 404 when Clerk is selected, and Clerk logout does not manipulate a provider cookie or reflect provider errors. Keep return-path rejection for `//host` and absolute URLs.

- [x] **Step 2: Verify RED**

Run the three focused route tests. Expected: provider dispatch cases fail against WorkOS-only routes.

- [x] **Step 3: Add conditional provider and controls**

Place `ClerkProvider` inside `<body>` only:

```tsx
<body>
  {usesClerkIdentity() ? <ClerkProvider>{children}</ClerkProvider> : children}
</body>
```

Create a client `ClerkAuthControls` component using only `@clerk/nextjs`:

```tsx
"use client";

import {
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

export function ClerkAuthControls() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" />
        <SignUpButton mode="modal" />
      </Show>
      <Show when="signed-in">
        <OrganizationSwitcher hidePersonal />
        <UserButton />
        <SignOutButton />
      </Show>
    </>
  );
}
```

Use Clerk `<SignIn />` and `<SignUp />` on their catch-all pages. Render the control component naturally in the existing landing/header only for Clerk. Keep the existing WorkOS/local links and sign-out form otherwise.

- [x] **Step 4: Dispatch auth routes**

The login route passes `{ tenantId: null, returnPath, requestUrl: req.url }` into the neutral gateway login operation. The WorkOS callback rejects non-WorkOS deployments before reading query parameters. The logout route obtains the provider-selected credential, calls the selected gateway best-effort, always clears module-access cookies, and clears `opentenant_session` only for WorkOS/local.

- [x] **Step 5: Verify GREEN and secret isolation**

Run platform tests/typecheck/build. Run:

```bash
rg -n "CLERK_SECRET_KEY" apps/platform --glob '*.{ts,tsx}'
```

Expected: the secret name appears only in server-only composition/config code and never in `auth-controls.tsx` or another client module.

- [x] **Step 6: Checkpoint**

```bash
git add apps/platform/app apps/platform/lib
git diff --cached --check
git commit -m "feat: add Clerk browser auth controls"
```

### Task 7: Make provisioning and member settings provider-neutral

**Files:**
- Modify: `apps/platform/app/api/admin/tenants/route.ts`
- Modify: `apps/platform/app/api/admin/tenants/route.test.ts`
- Modify: `apps/platform/app/settings/members/page.tsx`
- Modify: `apps/platform/app/api/settings/members/route.ts`
- Create: `apps/platform/app/api/settings/members/route.test.ts`
- Modify: `apps/platform/app/settings/identity/page.tsx`
- Modify: `apps/platform/app/api/settings/identity-portal/route.ts`
- Create: `apps/platform/app/api/settings/identity-portal/route.test.ts`

- [x] **Step 1: Write failing provider-neutral route tests**

Parameterize tenant compensation tests for WorkOS and Clerk and assert the selected provider is persisted as a bound SQL parameter. Add member tests proving:

```ts
const body = new URLSearchParams({
  op: "remove",
  membershipId: "mem_internal_example",
});
```

is accepted only when `identityGateway().listTenantMembers(tenantId)` returns the same internal ID for the active tenant. Prove an external-looking provider ID is not a special accepted format, last-owner protection uses canonical `tenant_owner`, and audit details include only `membershipId`/canonical role. Add identity-portal tests: WorkOS capability redirects after audit; Clerk returns a provider-neutral 404 or renders the local member-management path without calling WorkOS.

- [x] **Step 2: Verify RED**

Run focused platform route tests. Expected: failures from hard-coded provider SQL, `workosPort()`, `om_` validation, and direct external IDs.

- [x] **Step 3: Neutralize tenant provisioning**

Read `identityProviderFromEnv()` once, use `identityOrganizationPort()` for create/delete, construct the provider-bound mapping, and bind the provider SQL parameter. Remove `externalOrganizationId` from audit detail. Keep the existing create-before-transaction and compensating-delete ordering exactly.

- [x] **Step 4: Neutralize member settings**

Render `await identityGateway().listTenantMembers(tenantId)`. Form values use `membershipId`. The route matches that internal ID within the tenant-scoped normalized list, applies last-owner checks to canonical roles, calls `identityGateway().removeMembership(membershipId)`, and audits only internal IDs and canonical role/status.

For Clerk, the identity settings page links users to the in-app members page and OrganizationSwitcher instead of offering WorkOS Admin Portal intents. The WorkOS route remains capability-gated and unchanged for WorkOS deployments.

- [x] **Step 5: Verify GREEN**

Run platform tests, typecheck, lint, and production builds for `IDENTITY_PROVIDER=local`, `workos`, and `clerk` (the Clerk build uses ignored development configuration without printing it). Expected: all commands exit 0 and no provider identifier is present in rendered form fixtures or audit assertions.

- [x] **Step 6: Checkpoint**

```bash
git add apps/platform/app/api/admin/tenants apps/platform/app/api/settings apps/platform/app/settings
git diff --cached --check
git commit -m "feat: support provider-neutral identity administration"
```

### Task 8: Local runtime, review, durable records, and graph

**Files:**
- Modify: `.env.example`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/SHIPLOG.md`
- Modify: `docs/OWNER-TASKS.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/2026-07-20-unattended-development.md`
- Modify: `graphify-out/**`

- [x] **Step 1: Document configuration without account-specific values**

Add placeholder-only Clerk variables to `.env.example`, provider-selection guidance to the deployment runbook, and the provider-plan/custom-role constraint. Do not include the demo app ID, domains, instance IDs, credentials, or copied dashboard values.

- [x] **Step 2: Run focused runtime checks**

Start the app on Node 22 with local identity and verify `/`, `/auth/login`, `/assessment`, member settings authorization, and logout. Start once with WorkOS configuration and confirm its login/callback regression path. Start once with Clerk development configuration and confirm middleware boots, signed-out controls render, and missing/unknown active organization fails closed before any live synthetic resource is created.

- [x] **Step 3: Run the full required gates**

```bash
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm turbo typecheck lint test --force
PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:$PATH pnpm turbo build --filter=@opentenant/platform --force
git diff --check
```

Expected: 0 failed tasks/tests/builds. Record exact counts from fresh output.

- [x] **Step 4: Perform independent review and goal-truth audit**

Review the final diff without implementer rationale. Search for provider SDK imports, account/resource identifiers, credentials, provider response logging, external IDs in platform forms/audits, client secret references, non-exhaustive provider selection, and tenant validation with `expectedTenantId = null` on tenant-sensitive paths. Fix confirmed findings and rerun affected checks, with at most two review/fix passes.

- [x] **Step 5: Update durable records**

Record completed behavior and verification in HANDOFF, SHIPLOG, OWNER-TASKS, and the unattended ledger. Mark live browser signup/organization cleanup as not verified until the separate demo plan completes.

- [x] **Step 6: Refresh and validate Graphify**

```bash
graphify update .
graphify check-update .
graphify query "How does a Clerk browser session become a tenant-bound OpenTenant session?" --budget 2200
```

Validate `graph.json` for duplicate node IDs and dangling edge endpoints, then inspect the generated diff.

- [x] **Step 7: Final checkpoint**

```bash
git add .env.example docs graphify-out
git diff --cached --check
git commit -m "docs: record Clerk provider foundation"
```

Do not push until every preceding acceptance check is fresh and green.
