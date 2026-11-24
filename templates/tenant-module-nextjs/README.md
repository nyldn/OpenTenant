# Tenant module Next.js UI starter

This Apache-2.0 starter is the redistribution-safe UI baseline for installation
owners and tenant developers. It uses Next.js, Tailwind CSS v4, semantic brand
tokens and the official shadcn/ui registry. Copy it into a tenant module
workspace, then add only the primitives and blocks that screen requires.

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
pnpm dlx shadcn@latest info
pnpm dlx shadcn@latest add button card form table
pnpm build
```

Run `view`, `--dry-run` and `--diff` before every registry install. Keep a
locked dependency graph and review each resulting source file, licence,
install script, environment variable and network destination before publish.
Copy `pnpm-workspace.yaml` and `pnpm-lock.yaml` with the starter: they are the
standalone dependency-policy boundary, including the patched sharp/libvips
and PostCSS resolutions. Regenerate and re-audit both whenever a dependency
changes.

The starter intentionally contains no Shadcn Studio, v0, private-registry or
provider credential configuration. Studio's licence does not permit using its
resources in an end-user product builder. A future OpenTenant-owned registry
may be added only after its item versions, source provenance, licences and
server-side approval identifiers are frozen.

Tenant branding should override semantic CSS variables such as `--primary`,
`--background` and `--ring`; do not hard-code a customer brand into a shared
module. UI source never grants data access. Every module data operation still
requires an independently declared and approved OpenTenant capability.
