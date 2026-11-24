# Getting started

Use a checkout of OpenTenant with Node 22.23.2, pnpm 11.13.1, Docker and Docker
Compose installed. These versions come from [package.json](../../package.json)
and [.nvmrc](../../.nvmrc). Use synthetic data only.

## Scaffold a host from packed packages

`create-opentenant` creates a minimal synthetic host using built package exports,
typed configuration, an installation composition, Compose and placeholder env
settings. It applies canonical migrations and uses the Postgres provisioner to
seed one tenant database with a restricted RLS login. This package is unpublished.
Use real local `pnpm pack` artifacts until an owner approves publication.

```sh
pnpm install --frozen-lockfile
pnpm turbo build
mkdir -p /tmp/opentenant-packs
pnpm -r --filter './packages/*' --filter './modules/*' --filter @opentenant/migrations --filter @opentenant/provisioning pack --pack-destination /tmp/opentenant-packs
# Supply POSTGRES_ADMIN_DATABASE_URL for a disposable pgvector Postgres 17 server.
node packages/create-opentenant/dist/cli.js --name example-app --identity local --provisioning postgres --tarballs /tmp/opentenant-packs --yes
pnpm --dir example-app start
```

Use `--identity better-auth` for the self-hosted adapter. The synthetic owner
credentials are written to the ignored, mode-0600 `.opentenant-demo-identity.json`,
never printed. Keep both generated identity and runtime binding files private.
The welcome page is public synthetic content. Authenticated module-host ports,
production credential custody and deployment belong to the full platform below.
The starter binds loopback and does not authorize production use.

`pnpm dx:timed` builds and packs the packages, creates a fresh `node:22` container
without host node_modules or cache mounts, installs the packs, migrates and seeds
Postgres, typechecks and starts the host, and asserts home returns HTTP 200.
It fails above 600 seconds and writes a JSON duration report. Set
`DX_TIMED_REPORT` to choose its path and `DX_IDENTITY=better-auth` to select that
adapter. CI runs both identity choices. The full platform checkout remains the
path for the complete application.

## Local setup in five commands

Run these five commands from the repository root. The third command writes
local settings to an ignored Next.js environment file without printing them.
Keep any existing environment file before replacing it.

```sh
pnpm install --frozen-lockfile
cp .env.example apps/platform/.env.local
node --input-type=module <<'JS'
import { appendFileSync } from 'node:fs';
appendFileSync('apps/platform/.env.local', '\n' + [
  'IDENTITY_PROVIDER=local',
  'LOCAL_PUBLIC_ORIGIN=http://localhost:3000',
  'CONTROL_PLANE_DATABASE_URL=postgresql://opentenant:opentenant-local@localhost:55432/opentenant',
  'PLATFORM_DEFAULT_TENANT_ID=tenant_local',
].join('\n') + '\n');
JS
pnpm local:setup
pnpm dev
```

`local:setup` starts the Postgres 17/pgvector service at loopback port 55432,
applies canonical control-plane migrations, and seeds `tenant_local`,
`user_local` and module entitlements. It is repeatable. It does not provision a
tenant database. Source: [root scripts](../../package.json),
[Compose](../../compose.yaml), [local migrations and seed](../../tooling/migrations/src/local.mjs).

Next reads `apps/platform/.env.local` when started through `pnpm dev`. Other
operator commands need their environment supplied separately; they do not
implicitly load that file. Configuration names and validation live in
[server-config.ts](../../apps/platform/lib/server-config.ts).

## Your first tenant and module

Open `http://localhost:3000/auth/local?return=/assessment`. The local login route
sets the development session cookie and redirects to the Assessment example.
The development host fallback selects the seeded `tenant_local`. Assessment's
basic questionnaire and results run with synthetic browser-local state. This
is the first-module walkthrough; Support and Knowledge persistence need a
provisioned tenant database.

Source: [local login](../../apps/platform/app/auth/local/route.ts),
[local identity defaults](../../packages/auth/src/local/gateway.ts),
[tenant resolution](../../apps/platform/lib/tenant.ts),
[Assessment page](../../modules/assessment/src/host-page.tsx).

## Your first provisioned tenant

For durable tenant data, select an organization-capable identity adapter from
[providers](providers.md), such as self-hosted Better Auth. Local identity
cannot create provider organizations. Supply `PROVISIONING_PROVIDER=postgres`,
`POSTGRES_ADMIN_DATABASE_URL`, `POSTGRES_TENANT_REGION` and a generated
`TENANT_DB_ENCRYPTION_KEYS` keyring with `TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID`.
Keep the admin URL in trusted server/worker configuration. It needs permission
to create databases and restricted login roles. Do not put secrets in a shell
history or share them with modules.

Sign in as the installation owner and open `/admin/tenants/new`. Enter the
name, slug, region and synthetic owner email. Submission returns a queued
provisioning job. Run the worker with that same server environment loaded:

```sh
pnpm worker --migrate
pnpm worker
```

The worker creates the identity organization, provisions a tenant database,
issues a single-use expiring owner claim and activates the tenant. Configure
`OPENTENANT_TENANT_BASE_DOMAIN` and verified domain records plus DNS/ingress for
the tenant hostname. Production never uses the development fallback.

Source: [creation route](../../apps/platform/app/api/admin/tenants/route.ts),
[worker CLI](../../apps/platform/workflows/worker.ts),
[worker provisioning](../../apps/platform/workflows/tenant-worker.ts),
[provisioning composition](../../apps/platform/lib/provisioning.ts),
[owner invites](../../apps/platform/lib/tenant-owner-invite.ts).

## Adding your own module

Read the [module contracts](../../packages/platform-core/src/modules.ts) and
[SDK](../../packages/module-sdk/src/index.ts), then use
[the remote Next.js starter](../../templates/tenant-module-nextjs/README.md).
Register a reviewed manifest, bind its version in the tenant entitlement and
grant only the permissions it needs. Enabling a navigation item does not grant
a data capability. Remote publication and hosted sandbox execution still have
installation approval gates; no one-command public registry install is claimed.

The [registry](../../apps/platform/lib/module-registry.ts) and
[module UI guide](../product/module-ui.md) describe current integration points.

## Verify and stop

```sh
pnpm restore:drill
pnpm docs:links
docker compose stop postgres
```

The restore drill uses disposable databases independent of the seeded local
installation. It needs Linux Docker host networking and the CI pgvector image
already cached. See [the restore procedure](../runbooks/backup-restore.md).
Stopping the development service keeps its named volume. Deleting that volume
would discard the local database.
