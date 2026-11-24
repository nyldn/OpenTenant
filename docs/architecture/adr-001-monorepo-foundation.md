# ADR-001: Monorepo and provider boundaries

Status: accepted

## Decision

OpenTenant is a pnpm/Turborepo monorepo targeting Node.js 22 and strict
TypeScript. `apps/platform` is the application composition root; `modules/*`
contain native examples; `packages/*` contain narrow domain contracts; and
`tooling/*` contains migrations, CI, and optional provisioning adapters.

Provider SDKs stay in adapters or composition roots. Package names use the
`@opentenant/*` scope. Local development is the default and does not require a
cloud account.

## Consequences

- Cross-package contracts are reviewable and independently testable.
- Hosted providers can change without becoming module APIs.
- CI runs lint, typecheck, tests, build, and secret scanning.
- Account IDs, resource IDs, domains, regions, and credentials are runtime
  configuration and never repository constants.
