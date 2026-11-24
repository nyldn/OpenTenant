# Reproducible deployment

Use Node 22 and pnpm 11.13.1. These definitions support local verification;
they do not authorize a hosted deployment or establish production readiness.
No account, team, project or tenant domain is canonical. Before using a remote
host, follow the owner gates in [deploy-preview.md](deploy-preview.md) and
[deploy-production.md](deploy-production.md).

## Self-hosted container

Run the disposable proof from the repository root with Docker and Compose:

```sh
node scripts/smoke-deploy.mjs
```

This builds the pinned Node 22 image using a frozen pnpm lockfile, starts
Postgres 17 with pgvector and the migration service, then starts the non-root
standalone Next.js app. It checks `/api/health`, a synthetic verified tenant at
`smoke.example.test` (a platform subdomain under the synthetic base domain), unknown-host denial and migration re-execution. It removes
its containers, volume, network and image tags even after an assertion fails.
It generates disposable credentials in memory and never prints them. Host ports
default to 3300 and 55435; `SMOKE_APP_PORT` and `SMOKE_POSTGRES_PORT` allow
concurrent runs. Image and Compose project names are unique per run.

For a persistent installation, supply the runtime variables below through an
ignored env file or the process environment. From the repository root:

```sh
docker compose --env-file .env.production -f compose.production.yaml up --build -d --wait
```

Set `COMPOSE_PROJECT_NAME` uniquely for each installation. `OPENTENANT_IMAGE`
and `OPENTENANT_MIGRATION_IMAGE` select image tags. `APP_PORT` and `POSTGRES_PORT`
default to the non-standard ports above. Both ports bind to loopback. A VPS
needs an operator-managed TLS proxy and wildcard DNS pointing at it.

Required runtime names are `POSTGRES_PASSWORD`, `MIGRATION_DATABASE_URL`,
`CONTROL_PLANE_DATABASE_URL`, `IDENTITY_PROVIDER`, `PLATFORM_PUBLIC_ORIGIN`,
`MODULE_ACCESS_SECRET`, `CONNECTIONS_STATE_SECRET` and
`OPENTENANT_TENANT_BASE_DOMAIN`. Production configuration validation also
requires an encryption key (`TENANT_DB_ENCRYPTION_KEY`, or
`TENANT_DB_ENCRYPTION_KEYS` with `TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID`),
`NEON_API_KEY` and `NEON_ORG_ID`, and the complete set for the selected
identity provider. The app does not become healthy until all of these are
valid. Self-hosted installations that never provision through Neon must still
set the Neon names today; see finding R11-18. `PLATFORM_ADMIN_HOST`
selects the administration hostname. The migration URL uses the database owner
role; use a separately provisioned role with only the runtime grants for the
app URL. Both URLs address the Compose service `postgres` at port 5432 and the
`opentenant` database. The Compose database owner is named `opentenant`.
Credentials enter only at runtime, never as build arguments. Keep secret files
outside copied source directories; `.dockerignore` excludes env files, common
credential files and local tool state. Do not run `docker compose config` or
capture container environment inspection when producing evidence.

Select exactly one hosted identity adapter. WorkOS names are `WORKOS_API_KEY`,
`WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`. Clerk names
are `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER`,
`CLERK_AUTHORIZED_PARTIES`, `CLERK_JWT_AUDIENCE`. Supply the selected provider's
complete set. Local identity remains development-only. The smoke uses anonymous
pages with the WorkOS adapter selected and no provider credentials or requests.

The one-shot service runs the hosted migration runner
(`tooling/migrations/src/hosted.mjs control-plane`, the same code as
`pnpm migrate:hosted`) with checksum verification. It requires
`--target <host:port>` to match the database URL; compose passes
`MIGRATION_TARGET_HOST`, defaulting to `postgres:5432`. Without a target the
image refuses to run. It neither seeds a platform administrator nor
provisions tenant databases; migrate the tenant fleet with
`pnpm migrate:hosted tenant-fleet` per [hosted migrations](hosted-migrations.md).
Provision tenants through the reviewed provisioning path before serving them.
In production mode each exact tenant hostname needs a verified active domain
record. `*.localhost` resolves to loopback in compatible browsers; registration
is still required. There is no wildcard default-tenant bypass.

`/api/health` currently proves process liveness only. It does not prove database
readiness, identity, tenant provisioning or an SLO. Run the tenant smoke and
operational gates separately. Back up the named volume before upgrades. To stop
without deleting data, use the same Compose options with `down`; add `--volumes`
only for disposable installations.

The Dockerfile adapts the official Next.js MIT example. The exact upstream
revision and terms are in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Vercel REST preview

The helper defaults to a dry run and performs no request unless both `--apply`
and an explicit command-line `--project` are present. No Vercel CLI is used.
For each operation, review its dry run first:

```sh
node tooling/ci/vercel-preview.mjs domain-add --dry-run --domain '*.example.test'
node tooling/ci/vercel-preview.mjs env-check --dry-run --identity workos
node tooling/ci/vercel-preview.mjs deploy --dry-run --name "$VERCEL_PROJECT_NAME" --repo "$GITHUB_REPO_ID" --ref "$RELEASE_REF" --sha "$RELEASE_SHA"
```

After separate owner approval for each operation, replace `--dry-run` with
`--apply --project "$VERCEL_PROJECT_ID"`. Supply `VERCEL_API_KEY` through the
environment. `--team` or `VERCEL_TEAM_ID` selects a team if required. The helper
ignores `VERCEL_PROJECT_ID` in the environment unless passed as `--project`.
The wildcard is an operator-supplied domain, never a repository default.

`env-check` prints only the required names and whether they are present in the
preview target. `--ref` includes matching branch overrides. It requests
`decrypt=false` and discards all returned values. It does not validate values
or create missing variables. The names checked are the common application
names and the selected provider names listed above. Tokens, response bodies
and transport errors are never printed. A successful mutation prints only an
acceptance message. Apply failures stop with a normalized error.

The [root vercel.json](../../vercel.json) supplies only the build command.
Vercel does not support `rootDirectory` in vercel.json. The git deployment
request passes `projectSettings.rootDirectory` as `apps/platform` and the
configured build command. These are the only build/root overrides; account,
domain, region and team stay runtime settings. The command builds from the
workspace root so pnpm can resolve internal packages. Vercel must use Node 22
and the repository's `packageManager` pin. The deployment omits `target` to
create a preview, never a promotion. Use the approved operator workflow to
read deployment status and domain verification challenges, then complete the
checks in [deploy-preview.md](deploy-preview.md). Adding a wildcard does not
configure DNS or verify an OpenTenant tenant domain.

API references: [domain add](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project),
[environment names](https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name),
[git deployment](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment).
Tests mock fetch; no hosted deployment has been verified.

## Optional Kamal VPS path

[config/deploy.yml.example](../../config/deploy.yml.example) is an original MIT
Kamal 2 template with placeholders only. Copy it to an ignored operator config,
replace the host, registry, image, architecture and identity placeholders, and
provide its secret names through Kamal's secret store. Keep the reviewed
Dockerfile and lockfile unchanged. Add `.kamal/secrets` to the local ignore
rules before using it. Configure TLS and wildcard routing for the approved
domains in the VPS proxy. Run the migration image once with the owner URL
before rolling out the app, and provision tenant databases separately.
After those prerequisites and explicit VPS authority, the application rollout
command is:

```sh
kamal deploy --config-file config/deploy.yml
```

Kamal pushes an image and changes remote hosts. This task has not run that
command or verified a VPS. The example is optional configuration, not a claim
of a production-tested Kamal installation.

## Tenant provisioning providers

Set `PROVISIONING_PROVIDER=postgres` and `POSTGRES_ADMIN_DATABASE_URL` for an operator-owned Postgres server. Its login needs CREATE DATABASE and CREATE ROLE. Tenant logins are unique per database and inherit the restricted migration-granted role. Database CONNECT is revoked from PUBLIC. `POSTGRES_TENANT_REGION` describes the operator server, with no geographic routing. The tenant `ap` label is accepted with this provider; the operator is responsible for the declared location.

`PROVISIONING_PROVIDER=neon` requires `NEON_API_KEY` and `NEON_ORG_ID` and accepts `us` or `eu`. Neither provider requires the other provider credentials. Changing providers for an existing installation requires migrating tenant databases and checkpoints; it is not a runtime failover switch.

The Postgres administrator must also be allowed to install the tenant catalogs' required extensions, including pgvector. The local proof uses a disposable administrator login, not production credentials. For Docker builds on hosts whose bridge cannot reach npm, the smoke script accepts `SMOKE_BUILD_NETWORK=host`; runtime services keep their Compose network.
