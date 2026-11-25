# Adopting OpenTenant

Start with a local, synthetic installation. OpenTenant is pre-1.0; a passing
local check does not establish production readiness or a recovery SLA.

- [Getting started](getting-started.md). Run the platform, provision a tenant, and add a module.
- [Concepts](concepts.md): how requests, tenant data and module authority fit together.
- [Providers](providers.md): choose identity, authorization, provisioning and integrations.
- [Operations](operations.md): deploy, migrate, rotate, restore and observe.
- [Security model](security-model.md): trust boundaries and operator responsibilities.
- [FAQ](faq.md): practical limits and common setup problems.

These guides cite executable source. The [documentation index](../README.md)
keeps architecture references and internal delivery records available separately.

## Checking these guides

From the repository root, run `pnpm docs:links`. It uses ISC-licensed
`markdown-link-check@3.15.0` for local file existence and heading/HTML anchors,
including cross-file fragments. It checks the root README, Markdown under
`docs/`, and package READMEs. External URLs are excluded; the check makes no
requests to the sites linked in the docs. The first invocation may download
the pinned checker from npm.

[The wrapper](check-links.mjs) checks disabled-link comments too. CI runs the
same command in the `docs-links` job. A missing file or anchor exits nonzero.
