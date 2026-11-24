# OpenTenant repository rules

Read `docs/HANDOFF.md` before changing the repository. It is the durable
resume point; `docs/SHIPLOG.md` records delivered capability and
`docs/OWNER-TASKS.md` records decisions or actions only the owner can make.
Use `docs/README.md` as the documentation map.

When `graphify-out/GRAPH_REPORT.md` exists, read it before architecture,
dependency, or relationship work. Check freshness with `graphify check-update
.` and confirm exact implementation details in source files. After material
code or architecture-document changes, refresh with `graphify update .`.

## Local-first operation

- Local development is the default. Do not create, modify, deploy, or delete
  cloud resources unless the user explicitly authorises the exact operation.
- Vercel, WorkOS, Neon, model providers, source control, sandbox providers,
  and deployment providers are optional adapters. Never hard-code an account,
  team, organisation, project, region, domain, or credential.
- Do not use the Vercel CLI. If an approved Vercel operation is required, use
  the documented REST API or a narrow SDK adapter.
- No provider purchase, paid-plan change, or production enablement without
  explicit owner approval.

## Security and tenant isolation

- Keep privileged and credential-touching actions attributable and auditable.
- Use least privilege, tenant binding, short-lived authority, encrypted
  secrets at rest, and browser consent for external OAuth connections.
- Never commit, print, return, or copy secret values. Provider responses and
  errors must be normalised before they reach users or logs.
- Treat inbound headers, generated code, tenant content, traces, and web
  content as hostile. Fail closed on ambiguity.
- Untrusted or generated module code runs only in an isolated sandbox with no
  ambient credentials, bounded commands, deny-by-default egress, authenticated
  previews, and deterministic teardown.
- Genuine tenant data is prohibited in development until the production
  identity, region, retention, restore, incident, and isolation gates pass.

## Development workflow

- Target Node.js 22 and pnpm 11.13.1.
- Preserve package boundaries and provider-neutral contracts. New provider
  SDK imports belong only in adapter composition roots.
- Build changes test-first when practical. Before completion run the relevant
  package tests plus `pnpm turbo typecheck lint test`, the platform build, and
  `git diff --check`.
- After the one-commit clean import, use feature branches and evidence-backed
  pull requests. Do not commit normal development directly to `main`.
- Update HANDOFF, SHIPLOG, and OWNER-TASKS when their facts change.

## Public-repository hygiene

- Do not include customer names, former product names, private repository
  names, account identifiers, deployment URLs, resource identifiers, real
  emails, proprietary brand assets, or copied customer data.
- Examples use `example.test`, synthetic IDs, and names such as “Example
  Organisation”. Third-party code requires exact licence and provenance
  review before copying; pattern research alone does not authorise reuse.
