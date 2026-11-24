# Implementation plan: installed module registry

## Summary
Keep the extension contract in the Apache-2.0 module SDK. Keep host composition
in apps/platform/opentenant-modules.ts. Use explicit module contributions and
registry projections instead of a second native-module list.

## Technical context
TypeScript, pnpm workspaces, Next.js native dispatch, PostgreSQL tenant catalogs.
Existing navigation resolution and authorization ports remain the policy engines.
Registry migrations reuse the canonical runner and historical migration IDs.

## Constitution check
Reuse existing authorization, navigation, migration and admission helpers. Keep
provider SDKs out of module definitions. Do not weaken tenant or role checks.
Preserve package ownership and historical migrations. No copied third-party code.

## Project structure
packages/module-sdk/src: definition, validation and registry projections.
modules/*/src/manifest.ts: built-in contributions.
apps/platform/opentenant-modules.ts: installation and native host bindings.
examples/module-hello: independent SDK-only sample and SQL.
tooling/migrations/src/tenant-modules.ts: registry-derived migration catalogs.

## Validation strategy
Test contract rejection, disabled entitlements, role ceilings, navigation overrides,
route dispatch and migration parity. Execute the sample SQL in disposable Postgres.
Run the requested full checks, build, RLS, migration, provisioning and browser
commands, plus repository security scans. Record exact outcomes and any timeouts.
