# Operations

Use installation-specific configuration and synthetic data during evaluation.
Production domains, accounts, retention and recovery targets are operator
choices. Export environment variables into each operator process explicitly;
`pnpm` scripts do not automatically load Next's `.env.local`.

## Deploy

The repository includes a non-root application image and a Postgres/migration
Compose stack. After preparing a protected `.env.production`, the persistent
self-hosted command is:

```sh
docker compose --env-file .env.production -f compose.production.yaml up --build -d --wait
```

Supply `POSTGRES_PASSWORD`, `MIGRATION_DATABASE_URL`,
`CONTROL_PLANE_DATABASE_URL`, `POSTGRES_ADMIN_DATABASE_URL`,
`IDENTITY_PROVIDER`, `PLATFORM_PUBLIC_ORIGIN`,
`OPENTENANT_TENANT_BASE_DOMAIN`, the credential keyring and separate
`MODULE_ACCESS_SECRET` / `CONNECTIONS_STATE_SECRET` values. Add the complete
selected identity provider configuration. The current Compose app forwards
WorkOS and Clerk settings; Better Auth needs explicit deployment environment
wiring before selecting it. The app selects Postgres provisioning in this stack.
Set `COMPOSE_PROJECT_NAME` to separate installations. Put an operator-managed
TLS proxy in front of its loopback application port and configure verified
hostname records. Provision tenants and run the worker separately.

Source: [Compose](../../compose.production.yaml),
[Dockerfile](../../apps/platform/Dockerfile),
[config validation](../../apps/platform/lib/server-config.ts).
The [deployment runbook](../runbooks/deploy.md) covers image and migration
settings. Its older Neon-only requirements are superseded by the provider
selection in server configuration.

## Migrate

With `CONTROL_PLANE_DATABASE_URL` supplied to this process, inspect pending
migrations first. Replace the example target with the exact configured host
and port. The second command applies forward migrations.

```sh
pnpm migrate:hosted control-plane --dry-run --target 127.0.0.1:55432
pnpm migrate:hosted control-plane --target 127.0.0.1:55432
```

Tenant-fleet migration additionally requires `--manifest` and `--canary`.
The manifest holds tenant IDs and privileged database URLs; protect it as a
secret. A checksum mismatch or failed canary stops rollout. Never edit applied
SQL to repair drift. Source: [operator runner](../../tooling/migrations/src/hosted.mjs),
[hosted migration procedure](../runbooks/hosted-migrations.md).

## Rotate keys

Configure the complete readable keyring in `TENANT_DB_ENCRYPTION_KEYS`, set
`TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID` to the new key, and supply
`KEY_ROTATION_ACTOR_ID` and `CONTROL_PLANE_DATABASE_URL` to the operator process.
Keep old keys while stored records or retained backups still need them.

```sh
pnpm keys:rotate --dry-run
pnpm keys:rotate --apply --batch-size 100
```

Save the printed run ID and use `--resume <run-id>` for interrupted work.
Rotation is audited and resumable. Never print the keys or connection records.
Module signing and audit checkpoint signing use separate keys and lifecycles.
Source: [rotation CLI](../../packages/database/src/credential-cipher-rotate.ts),
[key rotation procedure](../runbooks/encryption-key-rotation.md).

## Restore

```sh
pnpm restore:drill
```

The synthetic drill creates one control plane and two tenant databases through
Postgres provisioning. It dumps, destroys and restores them, then verifies
migration checksums, signed audit history, restricted-role isolation, decrypted
connection records and every table's row count. It measures RPO/RTO for its
small quiesced dataset. It needs Linux, Docker and the cached CI pgvector image;
it never reads an existing application database.

Production recovery requires approved recovery points, preserved evidence,
keyring availability, external checkpoint storage and a reviewed traffic
cutover. Follow [backup and restore](../runbooks/backup-restore.md).

## Observe

Use `/api/health` for liveness and `/api/ready` for control-plane readiness.
Readiness validates configuration and runs a bounded database `select 1`. It
returns 503 on failure; it does not
prove every tenant or identity provider is healthy. Monitor the worker,
provisioning jobs, per-tenant smoke checks, audit verification and restore
proofs separately.

`OPENTENANT_OTLP_ENDPOINT` opts into HTTP trace export. `SENTRY_DSN` opts into
server error capture. Leave them empty for local operation without collectors.
Set `OPENTENANT_TRUSTED_IP_HEADER` only behind ingress that strips/replaces that
header and blocks direct access. Source:
[readiness](../../apps/platform/lib/readiness.ts),
[ready route](../../apps/platform/app/api/ready/route.ts),
[observability](../../packages/observability/src/index.ts),
[SLO procedure](../runbooks/slo.md).

## Local publication proof

Run `pnpm release:local-proof` on a Docker host after installing dependencies.
It versions and builds a temporary source copy, validates all 23 public tarballs
with `pnpm package:check`, and publishes those exact bytes to a disposable
Verdaccio 6.10.5 registry. Verdaccio is MIT licensed. The registry binds a random
loopback port and proxies only third-party dependencies to npm. Project package
names never proxy to the public registry. The proof rejects publication targets
outside its explicit loopback registry.

A clean Node 22 container installs `create-opentenant` from Verdaccio, downloads
all validated project tarballs from that registry, scaffolds a synthetic local
identity host, typechecks it and verifies tenant home HTTP 200 and authenticated
session access. Registry tarball hashes and exports must match the tarballs
validated by `package:check`. No host source, package-manager cache or node_modules
is mounted into the adopter. All registry, adopter and database resources are
removed after the run. The original source and versions stay untouched.

This provides local publication and installation evidence. npm provenance
attestations require GitHub OIDC and are verified only when the owner-gated
[release workflow](../../.github/workflows/release.yml) runs against npm. The
local proof cannot attest public publication or provenance. Public release
remains an owner decision, `OWNER-NPM-RELEASE-01`.
