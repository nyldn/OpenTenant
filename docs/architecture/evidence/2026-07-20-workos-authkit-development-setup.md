# WorkOS AuthKit development setup evidence

Date: 2026-07-20

## Scope and authorization

The owner described the WorkOS account as fresh and dedicated it to OpenTenant
development, then authorized use of the ignored `.env` API key and client ID
to create the minimum development configuration. The API inventory observed no
users, but it cannot independently prove the provenance of pre-existing
provider objects. This probe did not enable production, configure a domain, or
use genuine tenant data. The initial setup created no identity objects. A later
bounded runtime exercise created one uniquely named synthetic organization,
one `example.test` user, and one `tenant-owner` membership, then removed all
three.

No credential, provider object identifier, account identifier, or hosted URL
is recorded here.

## Configuration applied

- Generated an ignored local `WORKOS_COOKIE_PASSWORD` with at least 32
  characters.
- Set the ignored local `WORKOS_REDIRECT_URI` to the existing
  `http://localhost:3000/auth/callback` route.
- Registered that exact local callback through the WorkOS management endpoint;
  a second request reported that it already existed.
- Created the environment-level `tenant-owner` and `tenant-admin` role slugs
  already defined at the WorkOS adapter boundary. Readback found both roles;
  a second setup pass created nothing.
- Left all pre-existing organisations and permissions unchanged and made no
  claim about their provenance. No permission vocabulary is inferred from
  provider defaults because the Developer MCP permission contract remains
  owner-gated.

## Runtime proof

OpenTenant ran locally on Node `v22.23.1` with `IDENTITY_PROVIDER=workos` set
for the process only.

- `GET /auth/login?return=/dashboard` returned HTTP 302 to the WorkOS
  authorization endpoint.
- The authorization request contained a client ID, selected AuthKit, used the
  exact registered local callback, and preserved `/dashboard` in state.
- Following the provider redirects returned HTTP 200 HTML from the hosted
  authentication surface.
- `GET /auth/callback` without a code returned the established generic HTTP
  400 response.
- A synthetic invalid code returned the established generic HTTP 401 response,
  included no provider detail, and set no session cookie.

A successful callback and authenticated tenant session required the bounded
synthetic exercise recorded below. Tenant organization creation remains owned
by OpenTenant provisioning for product traffic so the provider mapping and
control-plane tenant record are committed together. That provisioning route
invokes organization creation and compensating deletion through the auth
package's narrow WorkOS port rather than importing the provider SDK directly.

## Successful synthetic tenant session

The follow-up exercise used the existing localhost callback and local
PostgreSQL control plane; it did not create Neon or Vercel resources.

- A temporary email-verified `example.test` user received one active
  `tenant-owner` membership in a temporary synthetic WorkOS organization.
- The organization was mapped to a temporary active local tenant. No provider
  identifier was persisted outside ignored runtime state and local rows.
- Browser-driven hosted AuthKit email/password sign-in returned through the
  real `/auth/callback` route to `/`.
- The browser held exactly one `opentenant_session` cookie with a non-empty
  value and the expected `HttpOnly`, `Secure`, `SameSite=Lax`, and `/`
  attributes. The value was not printed or persisted as evidence.
- The application rendered the mapped synthetic workspace and exposed tenant
  settings, proving the sealed session resolved an exact active membership and
  the `tenant-owner` application role.
- Control-plane readback found one WorkOS account link for the synthetic
  subject, confirmed it was not a platform administrator, and confirmed the
  exact tenant/organization mapping.
- Cleanup revoked the one observed session and removed one membership, user,
  organization, local account link/user, and local tenant. Final readback found
  zero synthetic users, organizations, tenants, or account rows. The WorkOS
  environment again contained zero users.

The exercise also reproduced and fixed a local bootstrap defect before the
successful retry: plain `localhost` with `PLATFORM_DEFAULT_TENANT_ID` attempted
to query an uninitialized pool. The exported `currentTenant()` path now lazily
initializes the shared control-plane pool, with a regression test covering the
exact inputs that returned HTTP 500. The successful retry returned HTTP 200.

## Sanitized readback

- Required credential variables: present.
- Cookie password length: accepted.
- Local callback: registered and idempotent.
- Required environment roles: present and idempotent.
- Synthetic authenticated tenant session: passed.
- Temporary provider and local objects after cleanup: zero.
- Development users after cleanup: zero.
- Secrets and provider identifiers in tracked changes: zero.

## Remaining boundary

The local hosted authentication and tenant-binding path is now runtime-proven
with synthetic data. Production origins, domains, login-abuse controls, group
mapping, permission slugs, FGA, real user onboarding, and genuine tenant data
remain explicitly unapproved.
