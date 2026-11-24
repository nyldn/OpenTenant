# Tenant module UI toolkit

Status: starter implemented; Developer MCP delivery remains foundation only

Date: 2026-07-21

OpenTenant supports UI development through two intentionally separate shadcn
surfaces. The separation is a licence, trust, and product boundary—not merely a
folder convention.

## 1. Reusable tenant-module starter

Installation owners and tenant developers can start remote-module screens from
`templates/tenant-module-nextjs`. The starter is Apache-2.0, builds as a
standalone Next.js application, uses Tailwind CSS v4 and semantic tenant-brand
tokens, and is configured for the official shadcn/ui registry.

The starter includes a small reviewed primitive baseline and can add any
official shadcn component locally:

```bash
cd templates/tenant-module-nextjs
pnpm dlx shadcn@latest info
pnpm dlx shadcn@latest view button
pnpm dlx shadcn@latest add button --dry-run
pnpm dlx shadcn@latest add button
```

shadcn copies source into the module workspace. That makes the module owner
responsible for reviewing and maintaining the resulting code and dependencies;
it does not turn OpenTenant into an opaque component runtime.

### Builder guardrails

- The default configuration exposes only shadcn/ui's built-in public registry.
- Registry items are inspected before installation and lockfiles are mandatory.
- New registry origins, install scripts, licences, environment variables and
  dependency changes require publish evidence and policy approval.
- Tenant branding arrives through semantic variables such as `--primary`,
  `--background`, `--ring` and `--radius`, never hard-coded customer selectors.
- UI source grants no tenant data access. Manifest requests and brokered module
  capabilities remain separately reviewed, tenant-bound and revocable.
- Generated and tenant-supplied source still runs only in the approved isolated
  sandbox with no ambient provider or database credentials.

The checked-in starter is usable now as source. It is not yet exposed through a
successful Developer MCP scaffold route; that route remains gated by the
versioned tool/resource schemas, server-owned template registry and launch
authorization decisions in `OWNER-TASKS.md`.

## 2. Private OpenTenant marketing workspace

OpenTenant's own marketing site is maintained as a separate local repository
and release. It uses shadcn/ui plus explicitly licensed Shadcn Studio resources
to create the public product story and reusable marketing design baseline.

The marketing workspace is not a monorepo package, release artifact, module
template, public registry or Developer MCP resource. Its Studio `EMAIL` and
`LICENSE_KEY` live only in that repository's ignored `.env`; OpenTenant provider
credentials are never copied into it.

This boundary is required because Shadcn Studio's current paid terms allow end
products but prohibit redistributing resources separately and prohibit products
that let end users build their own end products from those resources. Studio
components therefore cannot power OpenTenant's tenant-facing UI builder without
separate written licence terms from the vendor.

## Future OpenTenant registry

OpenTenant may publish its own reviewed shadcn-compatible registry later. It
must contain only OpenTenant-authored or compatibly licensed material and must
use immutable item versions, source digests, notices, dependency metadata and
server-side approval identifiers. A caller-supplied URL, item body or digest can
never make a registry resource approved.

References:

- [shadcn/ui registry namespaces](https://ui.shadcn.com/docs/registry/namespace)
- [shadcn/ui registry authentication](https://ui.shadcn.com/docs/registry/authentication)
- [Shadcn Studio CLI v4](https://shadcnstudio.com/docs/getting-started/how-to-use-shadcn-cli)
- [Shadcn Studio licence](https://shadcnstudio.com/license)
