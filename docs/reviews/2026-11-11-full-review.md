# Full repository, go-live, reusability and landscape review

Review date: 2026-11-11. Source revision: `89785b3` (`main` after PR #109).

This review covers four questions: what is broken, what blocks a first real
tenant, what stops other teams from adopting OpenTenant as a framework, and
which open-source projects now compete with it. Findings come from source
inspection and the local checks below. None of them is a claim of demonstrated
exploitation or of production behaviour, because there is no production
deployment.

## Baseline

| Check | Result |
| --- | --- |
| `pnpm check --force` (Node 22.23.2, pnpm 11.13.1) | 63/63 tasks passed, none cached |
| `pnpm audit --prod` | 6 critical, 18 high, 19 moderate, 4 low |
| Critical advisories | `next` 15.5.21: RCE in the Image Optimization API and on Windows-hosted servers, fixed in 15.5.28 or later. Also `piscina`, `@xhmikosr/decompress` and `proxy-addr`, all under the `workflow` spike dependency |
| Database and RLS suites | Run in CI against PostgreSQL 17. Not rerun for this review |
| Browser tests | None exist. There is no Playwright configuration or spec |

## Verdict

The tenant isolation design is strong. The review found no cross-tenant query
path. What it does have is the following:

- A provisioned tenant is not usable today. It gets an unreachable host, it
  has no support or brain schema, and it has no owner.
- There is no deployment or operations layer.
- The project is a well-secured product monorepo, not yet an adoptable
  framework.

The landscape scan found no TypeScript project that combines a separate
database per tenant, forced RLS, signed remote-module context, and audited
impersonation. However, identity and organisations, authorisation, metering
and sandboxes have all become commodity open source.

The decision pass (Fable 5) recommends four things:

- Continue, with narrower positioning as a governed tenant-module runtime.
- Go live with one design-partner tenant before extracting framework
  packages.
- Relicense the contracts that modules must import to Apache-2.0.
- Treat "one external tenant in production by day 65" as a hard gate.

## Bugs and security findings

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| R11-01 | P0 | `next` 15.5.21 carries critical RCE advisories | `apps/platform/package.json`, template `package.json` |
| R11-02 | P0 | Provisioned tenants get a hard-coded `${slug}.example.test` host. Production resolves tenants only by domain, so the tenant cannot be reached | `apps/platform/lib/tenant-provisioning-store.ts:75-76,160`, `lib/tenant.ts:54` |
| R11-03 | P0 | Provisioning applies only the tenant-core migrations, and the app role is granted only on `tenant_core`. `/support` fails on new tenants. CI hides this because `rls-proof.mjs` applies the support and brain SQL by hand | `lib/provisioning.ts:105-113`, `tooling/provisioning/src/app-role.ts:53-60`, `tooling/ci/rls-proof.mjs:643-644` |
| R11-04 | P0 | There is no path to create the first tenant owner. Invites allow only admin or member, and tenant creation creates only the identity-provider organisation | `api/settings/members/route.ts:29`, `api/admin/tenants/route.ts:81` |
| R11-05 | P2 | The module proxy passes `NEL`, `Report-To` and `Reporting-Endpoints` through, so a remote module can harvest origin-wide request URLs, including OAuth codes | `app/m/[module]/[[...path]]/route.ts:27-38,134-135` |
| R11-06 | P2 | The module proxy passes upstream CDN cache headers through and strips `set-cookie`, so a CDN can serve gated pages past the identity and passcode gate | same file, `:134-141` |
| R11-07 | P2 | A tenant admin can open the SSO and directory-sync portals and get around the owner-protection rule | `api/settings/identity-portal/route.ts:14,22` |
| R11-08 | P3 | The module proxy forwards POSTs without the same-origin check that every other mutation route performs. Sibling tenant subdomains count as same-site | `app/m/.../route.ts:121-132` |
| R11-09 | P3 | The member-removal advisory lock holds one connection from a 5-connection pool while it needs more connections from that same pool | `lib/member-mutation-lock.ts:12-20` |
| R11-10 | P3 | An identity-provider failure on invite returns a bare 500. The invite is created before it is audited | `api/settings/members/route.ts:33-46` |
| R11-11 | P3 | HMAC secrets fall back to `WORKOS_COOKIE_PASSWORD`. There are no anti-framing headers. The proxy passes upstream `Location` through, which is an open redirect. `/dev/tenant` is reachable in production and its suffix match has no dot boundary | `lib/module-access.ts:38`, `next.config.ts`, `app/dev/tenant/route.ts:18-24` |
| R11-12 | P2 | The schema allows the `ap` region, but the route and the Neon adapter accept only `us` and `eu` | `0017_data_region_ap.sql`, `tooling/provisioning/src/neon.ts:24` |
| R11-13 | P1 | The helpdesk projection pass has no caller, so `/admin/helpdesk` stays empty | `lib/helpdesk.ts:74` |
| R11-14 | P2 | The `workflows/heartbeat.ts` spike creates a table at runtime outside the migrations and opens a new pool on every step | `apps/platform/workflows/heartbeat.ts:25` |
| R11-15 | P3 | The audit chain has no external anchor for its head hash, and the row trigger does not block `TRUNCATE` | `tooling/migrations/sql/**/audit*` |

## Go-live blockers

**P0, engineering (about six weeks for one maintainer):**

- R11-01 to R11-04.
- A hosted migration command. `local.mjs` refuses non-loopback URLs and
  `applyToFleet` has no caller.
- A deployment definition. Today deployment is described only in prose and a
  `curl` command.
- Typed environment validation. About 25 variables are read ad hoc.
- A readiness check. `/api/health` always returns ok.

**P0, owner decisions:**

- The production account, region and domains.
- Backup RPO and RTO.
- The remote-module origin design.
- The passcode rate-limit design.
- Legal stewardship.

**P1, before general availability:**

- A background worker for the helpdesk projection and durable provisioning.
- Error reporting, tracing and metrics.
- Transactional email.
- Tenant suspend, delete, export and erase.
- Rate limits on settings, support and member routes.
- Rotation of the encryption key, with key IDs.
- Custom-domain verification.
- Self-serve signup, deferred.
- Billing, which is owner-gated.

**Sample modules:** Support is real but broken on new tenants (R11-03), and its
SLA, CSAT and email depth is library-only. Assessment is a localStorage demo
whose AI readout always fails in production. Brain is a stub that returns 501.

## Reusability scorecard

| Axis | Score | Main gap |
| --- | --- | --- |
| Modularity | 3/5 | Packages form a clean DAG, but about 50 logic modules and raw SQL live in `apps/platform/lib`, and product concerns sit in `platform-core` and `database` |
| Extension points | 2/5 | `ModuleManifest` is not consumed as a registry. Native modules are hard-coded and each needs a `transpilePackages` entry |
| Provider neutrality | 3/5 | `IdentityProvider` and the database provider are closed unions. `@vercel/functions` is wired directly into the pools |
| Publishability | 1/5 | Every package is `private`, exports raw TypeScript, has no build and no changesets. SQL is loaded through a webpack `?raw` import |
| DX and onboarding | 2/5 | No `create-*` CLI, no typed configuration, and the template is not wired to the platform |
| Docs for adopters | 2/5 | The roughly 100 docs are internal: handoffs, reviews and plans. None is an adopter guide |
| Licence fit | 2/5 | The core is AGPL. The Apache module SDK does not protect modules, because real modules import AGPL packages |

Target layout, extracted after go-live:

- `@opentenant/core`
- `@opentenant/next`
- `@opentenant/database`, which absorbs the migrations
- `@opentenant/module-sdk` (Apache)
- `@opentenant/admin-ui`
- Provider adapters, `@opentenant/{auth-workos,auth-clerk,auth-better-auth,db-neon,sandbox-*}`
- `@opentenant/cli`
- `create-opentenant`

`apps/platform` then becomes a thin reference host. The governance tooling
(`tooling/unattended`, Archify, `.agents`, `graphify-out`) and the internal docs
move out of the product repository.

## Landscape: side-by-side scores

Rubric weights: isolation 20, identity/org/RBAC 15, extensibility 15,
maturity and adoption 15, reuse as a framework and DX 10, licence for embedding
10, AI and agent readiness 5, white-label 5, audit and compliance 5. Stars and
last push were read through `gh api` on 2026-11-11. Two independent scorers
covered overlapping projects; where both scored a project, the scores below
are their average. The decision pass judged the OpenTenant self-score to be
biased and corrected it.

| Project | Kind | Licence | Stars | Total /5 |
| --- | --- | --- | --- | --- |
| ABP Framework | .NET app framework | LGPL-3.0 | 14.5k | 4.35 |
| Frappe Framework | Python framework, one database per site | MIT | 11.1k | 4.23 |
| fullstackhero starter | .NET multi-tenant kit | MIT | 6.9k | 3.90 |
| Keycloak | Identity, realms and organisations | Apache-2.0 | 37.8k | 3.90 |
| NocoBase | TypeScript plugin app platform | Apache-2.0 with extra terms | 24.9k | 3.70 |
| Appwrite | Backend-as-a-service | BSD-3 | 58.0k | 3.70 |
| Better Auth | TypeScript auth with organisations | MIT | 30.7k | 3.55 |
| Bullet Train | Rails SaaS framework | MIT | 1.9k | 3.50 |
| Zitadel | Identity, instances and organisations | AGPL-3.0 | 15.6k | 3.50 |
| Payload with the multi-tenant plugin | Next.js CMS | MIT | 45.8k | 3.45 |
| Logto | Identity, organisations | MPL-2.0 | 14.9k | 3.45 |
| Backstage | Plugin portal | Apache-2.0 | 34.8k | 3.45 |
| Directus | Data platform | Source-available | 38.7k | 3.45 |
| Supabase | Postgres backend-as-a-service | Apache-2.0 | 114.9k | 3.40 |
| Tenancy for Laravel | PHP, one database per tenant | MIT | 4.4k | 3.30 |
| django-tenants | Python, one schema per tenant | MIT | 1.9k | 3.05 |
| Hexclave (formerly Stack Auth) | TypeScript user infrastructure | MIT SDK, AGPL server | 6.9k | 3.00 |
| BoxyHQ SaaS starter | Next.js enterprise starter | Apache-2.0 | 5.0k | 3.00 |
| next-forge | Next.js monorepo starter | MIT | 7.8k | 2.95 |
| AWS SaaS Builder Toolkit | CDK control plane | Apache-2.0 | 345 | 2.90 |
| ixartz SaaS-Boilerplate | Next.js with Clerk organisations | MIT | 7.5k | 2.85 |
| Wasp Open SaaS | Full-stack starter | MIT | 16.3k | 2.80 |
| **OpenTenant, self-scored** | TypeScript tenant runtime | AGPL-3.0 | n/a | 3.40 |
| **OpenTenant, corrected** | | | | **2.55** |
| **OpenTenant, after the 90-day plan** | | | | about 3.5 |

What only OpenTenant combines:

- A hash-chained audit log.
- Short-lived signed context for remote modules, plus a capability broker.
- A database per tenant that also enforces RLS.
- Admission limits plus an exact usage ledger.
- Provider-neutral identity.
- A governed path toward AI-generated tenant modules.

Compose instead of build:

| Concern | Projects | Note |
| --- | --- | --- |
| Self-hosted identity | Better Auth (MIT) or Keycloak (Apache) | |
| SSO and SCIM | Ory Polis (Apache) | |
| Authorisation | OpenFGA or Cerbos (Apache) | |
| Metering | OpenMeter (Apache) | |
| Sandboxes | E2B or microsandbox (Apache) | Daytona went closed source in June 2026 |
| Database-level audit | pgAudit | |

## Recommended plan

1. **Days 0–40:** fix R11-01 to R11-12 and the P0 operations gaps. Bootstrap
   the first owner through an operator command that issues a single-use,
   expiring, audited owner invite. `owner` stays out of the normal invite
   roles. There is no self-serve signup in v1.
2. **Days 41–65:** run one design-partner tenant in production on Support. Add
   only the P1 items that tenant forces: a worker, email, observability, and
   suspend, delete and export.
3. **Days 66–90:**
   - Turn `ModuleManifest` into a real registry.
   - Relicense the contracts that modules import to Apache-2.0, after counsel
     confirms the boundary.
   - Publish `module-sdk`.
   - Add a Better Auth adapter.
   - Ship one callable Developer MCP route.
4. **Later:** `create-opentenant`, the full package split, billing, custom
   domains and SOC 2.

The largest risk is that the surface area grows past what one maintainer can
take to production. The mitigation is a scope freeze until an external tenant
is live. If no design partner exists by day 65, reconsider the project before
building more.

Marketing impact: `truth` once the fixes merge and the capability statuses
change. This review document itself makes no public claim.
