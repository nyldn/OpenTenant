# Getting started

## Try the full platform locally

Follow the [README quick start](../../README.md#run-it-locally). After
installing dependencies, `pnpm local:demo` starts the app, runs migrations,
and provisions synthetic tenants on random loopback ports. It fetches
the pinned PostgreSQL and Mailpit Docker images if they are missing.
Use a checkout without app dotenv files so Next.js cannot load provider
configuration into the demo.

1. Wait for **Demo ready** and copy the URL from `.uat/active/demo-url` into
   your browser. The private link signs you in as the Alpha owner and opens Support.
2. Enter a subject and a description, select **Open ticket**, then reload the
   ticket page. The saved ticket lives in Alpha's database.
3. To try Beta, open its persona link from the private `.uat/manifest.json` in
   a separate browser session.
4. Press Ctrl+C in the demo terminal to stop the demo. The next run creates
   fresh fixtures.

If the launcher reports app dotenv files, use a fresh checkout. If a demo or
UAT session already owns this checkout, stop it from its terminal or run the
demo from another checkout. The startup checks keep the current run and its
private sign-in files intact.

## Run with a local control plane

Use this setup for the browser-local Assessment example or when you want to
keep the control-plane database between runs. Run it from the repository
root after installing dependencies.

```sh
pnpm local:setup

IDENTITY_PROVIDER=local \
CONTROL_PLANE_DATABASE_URL=postgresql://opentenant:opentenant-local@127.0.0.1:55432/opentenant \
LOCAL_PUBLIC_ORIGIN=http://localhost:3000 \
PLATFORM_DEFAULT_TENANT_ID=tenant_local \
pnpm --filter @opentenant/platform dev --hostname 127.0.0.1
```

`pnpm local:setup` starts PostgreSQL 17 with pgvector on loopback port 55432,
runs the control-plane migrations, and seeds the synthetic `tenant_local`
tenant, developer user, and module entitlements. You can repeat it. Use this
database only for development.

This command passes settings to the dev process for that run. Put
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

### Add a native module

Add trusted modules to the [host composition](../../apps/platform/opentenant-modules.ts).
Each module owns its routes, permissions, and migrations. The host supplies
credentials, configuration, and service implementations.

For example, the platform passes its embedding configuration to Brain
through the factory at the package's manifest entry point.

```ts
import { createBrainModule } from "@opentenant/brain/manifest";

const brain = createBrainModule({
  resolveEmbedding: async () => (await import("./lib/server-config")).brainEmbeddingConfig(),
});
```

Register the returned definition in the existing `installedModules` list and
preserve the established migration order. Support uses
`createSupportModule({ handleAiRequest })` for its host-side AI handler.
Use the `BRAIN_MODULE` or `SUPPORT_MODULE` exports for default definitions.

Run `pnpm module:audit` to check module boundaries and
`pnpm module:adopter-proof` to exercise a packed module's installation,
navigation, entitlement checks, and migrations.

### Register a remote module

Start with the [SDK](../../packages/module-sdk/src/index.ts) and
[remote Next.js starter](../../templates/tenant-module-nextjs/README.md).
Register a reviewed manifest, bind its version in the tenant entitlement, and
grant the required permissions. Review the
[module contracts](../../packages/platform-core/src/modules.ts),
[registry](../../apps/platform/lib/module-registry.ts), and
[module UI guide](../product/module-ui.md) for the available integration points.
Publication and hosted sandbox execution require installation approval.

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
