# shadcn/ui CLI support

OpenTenant's shared design system is configured for the official shadcn/ui CLI.
The repository uses pnpm, Tailwind CSS v4, React Server Components, the Radix
Nova style, Lucide icons, and CSS-variable theming.

The CLI configuration is split across the two workspaces it needs to understand:

- `apps/platform/components.json` describes the Next.js application and routes
  shared UI additions to `@opentenant/design-system`.
- `packages/design-system/components.json` maps shared components, hooks, and
  utilities to their source directories.

The public shadcn registry requires no repository secret. No private registry
is configured. If a private registry is added later, reference its credential
by environment-variable name in `components.json`; never place the value in a
tracked file or command output.

OpenTenant now has three distinct CLI contexts:

- the platform design system below, for OpenTenant's native application UI;
- the Apache-licensed `templates/tenant-module-nextjs` starter, for
  installation-owner and tenant-private remote-module screens; and
- a separate private marketing repository, where licensed Shadcn Studio assets
  may be used for the OpenTenant marketing end product.

The Studio registries and credentials must never be added to either tracked
OpenTenant `components.json` file or the tenant-module starter. See the
[tenant module UI toolkit](../product/module-ui.md) for the product, licence and
sandbox boundary.

## Inspect the current setup

Use Node.js 22 and run:

```bash
cd apps/platform
pnpm dlx shadcn@latest info
```

The resolved UI directory should be
`packages/design-system/src/components/ui`. The CLI should report Tailwind v4,
RSC enabled, `radix-nova`, Radix primitives, and the Lucide icon library.

## Add a component

Run additions from the platform application as recommended for a monorepo:

```bash
cd apps/platform
pnpm dlx shadcn@latest add <component>
```

UI primitives are installed in the shared design-system package. Registry
blocks may also create app-specific composition files in
`apps/platform/components`.

Before changing an existing component, preview the operation:

```bash
pnpm dlx shadcn@latest add <component> --dry-run
pnpm dlx shadcn@latest add <component> --diff <file>
```

Existing components contain OpenTenant accessibility, sizing, branding, and
layout decisions. Do not use `--overwrite`, `init --reinstall`, or a different
preset without reviewing and deliberately merging those changes.

After adding a component:

1. inspect every created or changed file;
2. export a new shared primitive from `packages/design-system/src/index.ts` when
   consumers use the package root;
3. verify imports use the resolved aliases rather than a copied `@/components`
   path;
4. run the relevant package tests and `pnpm check`; and
5. refresh Graphify after material source changes.

## Tenant-module starter

The starter resolves the official built-in `@shadcn` registry and no additional
namespace:

```bash
cd templates/tenant-module-nextjs
pnpm dlx shadcn@latest info
pnpm dlx shadcn@latest add button card table --dry-run
```

Do not add Studio, v0 or a private registry to this default. A tenant-specific
registry may be considered later only through the Developer MCP dependency,
licence, origin and publication policy—not by accepting caller-supplied URLs.

## Private marketing workspace

The marketing project is deliberately outside this repository's pnpm workspace
and release. Its `components.json` may contain the Studio namespaces supplied by
the owner. CLI v4 expects `EMAIL` and `LICENSE_KEY` in that project's ignored
`.env` for premium content. Never copy the complete OpenTenant `.env` into the
marketing project.

Official references:

- [Installation](https://ui.shadcn.com/docs/installation)
- [Monorepo setup](https://ui.shadcn.com/docs/monorepo)
- [`components.json`](https://ui.shadcn.com/docs/components-json)
- [CLI](https://ui.shadcn.com/docs/cli)
