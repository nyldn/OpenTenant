# Better Auth identity adapter

The optional `@opentenant/auth-better-auth` package implements `IdentityGateway`
with self-hosted Better Auth 1.7.21. Better Auth, `@better-auth/sso` and
`@better-auth/scim` are MIT dependencies, consumed from npm without copied
implementation source. OpenTenant's adapter retains the repository licence.

An installation selects `IDENTITY_PROVIDER=better-auth`. WorkOS, Clerk and the
built-in development local adapter retain their existing paths. The adapter
owns all Better Auth imports; platform-core and module contracts remain vendor
neutral. The platform composition root imports the adapter package.

## Storage and tenant binding

Forward control-plane migration 0060 installs the pinned vendor schema with
`ba_` table names, including organization, SSO and SCIM tables. Migration 0061
adds unique organization/user memberships, idempotent pending invitations and
the owner-invitation prohibition. Application startup never calls a vendor
migration runner. `src/generate-migration.ts` is an operator-only compiler for
reviewing a future upgrade against a disposable copy of the current catalog.
It emits SQL to stdout and never overwrites an existing migration.

`identity_org_mappings` maps a Better Auth organization to one tenant and a
tenant to one organization for this provider. `PgTenantOrgResolver` and
`PgAccountLinkStore` supply the existing provider-scoped internal identifiers.
Account linking uses the database store's existing race-safe transaction. Email
never links accounts across providers. Automatic social/SSO account linking is
disabled.

The gateway verifies the signed session through Better Auth on every request,
then reads current organization membership and compares the mapped tenant with
the request's expected tenant. Cookie caching is disabled. Unknown roles,
unmapped organizations, missing memberships and wrong hosts confer no access.
No elevated module permission is inferred from an organization role.

| Better Auth role | OpenTenant role |
| --- | --- |
| owner | tenant_owner |
| admin | tenant_admin |
| member | tenant_member |

Normal invitations accept only admin/member, enforced in the gateway, plugin
hook and database. Accepted members can be promoted through authorized
OpenTenant administration. Only the platform's audited owner-bootstrap path
should grant the first owner. Directory reads paginate by immutable IDs in
batches of 100. Removal verifies the stored reference's tenant and user, deletes
the membership and revokes sessions active in that organization in one SQL
statement. Subsequent validation also rechecks membership.

All gateway exceptions become `IdentityAdapterError: Identity operation failed`
without causes, SQL, provider response bodies or credentials. HTTP failures
return a fixed message. Better Auth logging and telemetry are disabled.

## Browser and configuration

Set these server-only variables with the ordinary control-plane configuration:

```dotenv
IDENTITY_PROVIDER=better-auth
BETTER_AUTH_BASE_URL=http://localhost:3000
# Supply a randomly generated value of at least 32 characters locally.
BETTER_AUTH_SECRET=
```

Production requires an HTTPS origin and a secret of at least 32 characters.
HTTP is accepted only on loopback in development. The server config validates
these values without returning their contents in errors. The base URL is the
canonical installation origin. Tenant login additionally accepts an origin only
after the platform resolves its host to a tenant. Each host uses its own auth
origin and host-only cookies, with HttpOnly, SameSite=Lax, Path=/ and Secure on
HTTPS and in production. No shared parent-domain cookie is configured.

`/auth/login` redirects to `/api/auth/better-auth/login`, a server-rendered
email/password form with account registration. Login on a resolved tenant host
selects that tenant's mapped organization through the plugin's membership check.
A user without that membership is denied. The platform's existing POST logout
is rewritten only for this provider, revokes the Better Auth session and clears
the session and module cookie. Mutating HTTP requests require the same origin.
Responses use no-store and a restrictive content security policy.

The catch-all route uses an allowlist. Provider organization creation, role
mutations, invitations and account linking cannot be invoked through public
Better Auth endpoints. Organization administration remains a trusted server
operation behind the existing platform authorization and audit checks.

## SSO and SCIM boundary

The stable SSO and SCIM plugins and their schemas are installed. Both are
optional and disabled by default. `BETTER_AUTH_SSO_ENABLED=true` exposes sign-in
and protocol callback endpoints. Set `BETTER_AUTH_SSO_TRUSTED_ORIGINS` to a
comma-separated allowlist of vetted HTTPS IdP origins for discovery. This list
is used only when SSO is enabled. Public SSO registration stays blocked. An
operator must register and verify an IdP through the server-side plugin API;
email-domain organization provisioning and automatic account linking remain
disabled. A newly authenticated SSO subject needs an explicit membership. A
session selects an organization automatically only when exactly one mapped
membership exists, and host validation still checks that selection.

`BETTER_AUTH_SCIM_CONNECTION` is a server-only JSON object with `id`,
`organizationId`, `token` and `subjects`. The token must have at least 32
characters. `subjects` maps operator-reviewed immutable directory `externalId`
values to existing Better Auth user IDs. This is explicit linking, never email
matching. The configured organization must have one existing OpenTenant tenant
mapping. SCIM requests use the plugin's scoped bearer verification and native
interactive Postgres transactions.

SCIM creates only `member` memberships and marks them `scimManaged` through
migration 0062. Deactivation or deletion removes only these memberships and
revokes their organization sessions in the same transaction. Existing manual
memberships, including owners and administrators, remain under OpenTenant
administration. Group-derived elevated roles are intentionally unsupported.
Installations must choose one authority for each member; directory deactivation
does not revoke a separate manual membership. Unknown directory subjects fail
closed. With no connection, the SCIM verifier denies every bearer credential.

The adapter tests the SCIM create/delete projection against real Postgres.
Live IdP SSO, SAML interoperability and a complete external directory sync have
not been verified. See the upstream [SSO documentation](https://better-auth.com/docs/plugins/sso)
and [SCIM documentation](https://better-auth.com/docs/plugins/scim).

## Runbook: local development and operations

1. Start the local database with `pnpm local:setup`. The canonical migration
   runner discovers 0060–0062. Set the variables above in ignored local
   configuration, plus the existing control-plane database URL.
2. Start `pnpm dev`. Open `/auth/login` on the installation origin and create a
   synthetic account. Production sign-in requires verified email.
3. Create the tenant and its identity organization through the platform's
   existing administration path. For an existing local seed tenant, use a
   reviewed operator transaction to insert a `better-auth` organization mapping
   and the initial owner's `ba_member` row. Use the Better Auth subject created
   in step 2, never an email-derived identifier. This adapter does not replace
   the separate audited owner-bootstrap tool.
4. Sign in again on the tenant host, or on loopback with the configured
   development tenant override. The mapped active organization must match the
   host tenant. Creating an account alone grants no tenant membership.
5. Configure optional delivery with `IDENTITY_SMTP_HOST`, `IDENTITY_SMTP_PORT`,
   `IDENTITY_SMTP_FROM` and optional `IDENTITY_SMTP_USER`/`IDENTITY_SMTP_PASSWORD`.
   The platform composes `packages/notifications`' SMTP `EmailTransport` and
   injects verification and invitation hooks. With no host there is no transport.
   Production SMTP requires TLS. Invitations link to the verified tenant platform
   hostname and carry the reference through login/registration. URLs and tokens
   are not logged. Production onboarding needs a separately verified delivery
   service; the integration tests use a synthetic transport.
6. Back up the `ba_*` tables together with internal identity mappings. To revoke
   sessions after a secret compromise, rotate `BETTER_AUTH_SECRET`, restart the
   server and delete affected `ba_session` rows through an audited operator
   action. Removing an organization cascades members and clears active session
   organization references. Reverting the application provider does not drop
   identity data; no destructive down migration is supplied.

## Verification

`packages/testing/src/better-auth.integration.test.ts` registers Better Auth
on the same IdentityGateway contract as Local, WorkOS and Clerk. It uses the
shared ephemeral database runner, canonical migrations and real signed Better
Auth sessions, with no database-dependent skip in the dedicated proof. The same
file retains provider-specific SSO/SCIM, schema, HTTP, cookie and mail-hook checks.
The adapter's duplicate local conformance file has been removed.

```sh
pnpm db:ephemeral -- pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/better-auth.integration.test.ts
pnpm --filter @opentenant/auth-better-auth test
```

### Integration handoff for the migrations suite

The existing `tooling/migrations/src/control-plane-model-routing-store.integration.test.ts`
fixture applies every migration except 0029 before testing 0029. With later
forward migrations present, the runner correctly rejects adding 0029 after
0062. That fixture is outside this implementation's ownership. The integrator
can replace its baseline filter with the exported
`migrationCatalogBefore(allMigrations, modelRoutingStoreMigration.id)` helper,
then apply 0029 and the remaining suffix in chronological order. The adapter's
conformance fixture already applies the complete catalog in order and verifies
vendor schema drift against the resulting database.

## Verification record, 2026-11-11

The final uncached quality run passed 69 of 69 tasks and 1,679 tests. Its usual
integration suites are opt-in; the database proofs below ran separately against
`pgvector/pgvector:0.8.2-pg17-bookworm` on random loopback ports.

| Command | Result |
| --- | --- |
| `VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 pnpm turbo typecheck lint test --force --concurrency=3 --env-mode=loose` | 69 tasks, 1,679 tests passed |
| `pnpm --filter @opentenant/auth-better-auth test` | 13 passed, zero skipped, real Postgres |
| `pnpm --filter @opentenant/platform build` | Passed; 27 static pages plus dynamic routes, including the new auth handler |
| `pnpm rls:proof` | 314 checks passed across 31 tenant tables |
| `pnpm database:store-proof` | Seven suites, 30 assertions passed, zero skipped |
| `pnpm --filter @opentenant/migrations test --testTimeout=120000 --hookTimeout=120000` | 142 passed; six blocked by the one fixture failure described above |
| `pnpm audit --prod --audit-level high` | Exit zero; zero high/critical, one existing moderate advisory |
| `git diff --check` | Passed |
| `gitleaks git . --staged --redact --no-banner` | Zero leaks |
| `semgrep scan --jobs 1 --config packages/auth-better-auth/semgrep.yml --metrics off --disable-version-check --exclude node_modules --exclude graphify-out .` | Two local rules, 605 files, zero findings |
| `trivy fs --skip-version-check --skip-db-update --skip-java-db-update --scanners vuln,secret --skip-dirs node_modules --skip-dirs .next --skip-dirs graphify-out --format json --output /tmp/ba-trivy-final.json .` | Zero high/critical or secrets; two medium dependency instances |
| `graphify update .` | Refreshed locally; generated files excluded from the commit |

The Semgrep rules reject dynamic evaluation and disabled authentication origin
or CSRF checks. This was a focused local scan, not an exhaustive security audit.
An isolated Playwright CLI browser passed eight rendered-form checks, covering
the title, heading, sign-in, registration, required email/password controls,
invitation fields and sign-out. API behavior is covered by the real Postgres
conformance tests. MCP could not attach because its existing browser profile was
in use; that profile was preserved.

`ripwire apps/platform --edit-check=identityGateway` reported an unchanged
contract and zero incompatible callers. `ripwire . --quality-delta` reported a
clone between the exported migration-prefix filter and Archify's unrelated
finite-coordinate validator. Inspection confirmed different operations. The
report also flags the intentionally unwired migration test helper and new
adapter complexity; it is not recorded as a passing quality gate.

Earlier attempts hit an unrelated Assessment timing flake at four concurrent
Turbo tasks, memory pressure, five-second test timeouts and an empty
synthetic database password assertion. The final quality run used bounded test
workers, and the final migration run used a non-empty synthetic password and
longer timeouts. The container fixture now probes TCP readiness so the
temporary initialization server cannot satisfy its readiness check. The
remaining migration fixture failure is reproducible and
has not been suppressed. No production identity, external IdP or genuine user
data was used, and nothing was pushed or deployed.

## Browser integration correction, 2026-11-11

The native login forms use `strict-origin` referrer policy so Chromium retains
the same-origin POST Origin header. Cross-origin and null-origin submissions
still deny. The platform logout route forwards to the canonical Better Auth
sign-out path, preserving cookies and Origin; middleware no longer relies on a
rewrite whose original URL could reach the provider parser. Both login and MCP
confirmation pages retain their route-owned CSP headers.

The Better Auth Playwright journey signs up through the rendered form, accepts
a real invitation, signs out, proves the old signed session is revoked, signs
in through the form, and signs out again. It runs in the Better Auth phase of
`pnpm e2e`, alongside the local identity suite.
