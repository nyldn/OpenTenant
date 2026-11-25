# Getting started

## Try the full platform locally

Follow the [README quick start](../../README.md#run-it-locally) for the
supported Node and pnpm versions, the local database, and the command that
starts the app.

`pnpm local:setup` starts PostgreSQL 17 with pgvector on loopback port 55432,
runs the control-plane migrations, and seeds the synthetic `tenant_local`
tenant, developer user, and module entitlements. You can repeat it. Use this
database only for development.

The quick start passes settings to the dev process for that run. Put
persistent Next.js settings in the ignored `apps/platform/.env.local`. The root `.env`
is used for Docker Compose interpolation. CLI and worker processes need their
environment supplied separately. See the [workspace guide](../tooling/local-workspace.md).

## Your first tenant and module

Open the [local Assessment sign-in](http://localhost:3000/auth/local?return=/assessment).
The development session opens the Assessment questionnaire for `tenant_local`.
Answer a few questions to try the synthetic browser-local workflow.
For durable Support and Knowledge data, provision a tenant database below.

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

## Verify and stop

```sh
pnpm docs:links
docker compose stop postgres
```

Use Ctrl+C to stop the dev server before stopping PostgreSQL.

The optional `pnpm restore:drill` uses its own disposable databases. It needs Linux Docker host networking and the CI pgvector image
already cached. See [the restore procedure](../runbooks/backup-restore.md).
Stopping the development service keeps its named volume. Deleting that volume
would discard the local database.
