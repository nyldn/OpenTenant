<p>
  <img src="apps/platform/public/opentenant-mark.svg" width="64" height="64" alt="">
</p>

# OpenTenant

OpenTenant is a TypeScript framework for building applications that serve
multiple organizations. It resolves requests to a tenant, checks membership and
permissions, and gives your modules a tenant-scoped way to access data.

[Run it locally](#run-it-locally) · [Documentation](docs/README.md) ·
[Architecture](docs/architecture/platform-architecture.md) ·
[Changelog](CHANGELOG.md)

> [!NOTE]
> OpenTenant is pre-1.0. The examples use synthetic data. See
> [platform capabilities](docs/product/platform-capabilities.md) for what has
> been verified and what still needs production approval.

## Run it locally

Use Node.js 22.23.2 or later in the 22.x line, pnpm 11.13.1, and Docker.

```sh
git clone https://github.com/nyldn/OpenTenant.git
cd OpenTenant
pnpm install --frozen-lockfile
pnpm local:demo
```

Open the private URL in `.uat/active/demo-url` to sign in to the synthetic
Alpha tenant. Create a Support ticket and reload to see it saved. The demo
runs on loopback and uses local PostgreSQL and Better Auth. Press Ctrl+C to
stop it and remove its disposable data.

See the [adopter guide](docs/adopters/getting-started.md) for a quick start with
a local control plane, durable tenant provisioning, and module installation.

## What OpenTenant provides

- **Tenant context.** Resolve the incoming host before identity, data, or module
  access. Each deployment chooses a single identity provider.
- **Tenant data and administration.** Use tenant databases with restricted runtime
  roles and PostgreSQL row-level security. Manage membership, branding, domains,
  and module access in the platform shell.
- **Module contracts.** Add trusted native modules or integrate remote modules
  through a versioned manifest, signed context, and scoped capabilities.
- **Operational evidence.** Use canonical migrations, encrypted credential
  records, tenant audit chains, and restore procedures.

The control and tenant planes, supported provider options, and deployment limits
are covered in the [architecture](docs/architecture/platform-architecture.md)
and [provider guide](docs/adopters/providers.md).

## Find your next step

| I want to… | Start here |
| --- | --- |
| Evaluate the framework and its limits | [Platform capabilities](docs/product/platform-capabilities.md) |
| Provision a tenant or add my own module | [Getting started](docs/adopters/getting-started.md) |
| Build a remote module UI | [Module starter](templates/tenant-module-nextjs/README.md) |
| Set up a development checkout and Git hooks | [Local workspace](docs/tooling/local-workspace.md) |
| Plan a deployment, migration, or restore | [Operations](docs/adopters/operations.md) |
| Review the trust boundaries or report a vulnerability | [Security policy](SECURITY.md) · [Security model](docs/adopters/security-model.md) |

## Licensing and contribution

The core is AGPL-3.0-only. The remote module SDK and UI starter are Apache-2.0,
and the documentation is CC-BY-SA-4.0. See [Licensing](LICENSING.md) and
[Trademarks](TRADEMARKS.md) for the scope of each.

The source is public. External code, documentation, design, and asset
contributions are currently closed. See the [contribution policy](CONTRIBUTING.md).
