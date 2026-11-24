# Tasks: installed module registry

## Phase 1: contract
- [x] T001 Define module contributions and validate installed definitions.
- [x] T002 Test duplicate routes, permission declarations and role maps.

## Phase 2: host integration
- [x] T003 Compose built-in modules in one installation file.
- [x] T004 Derive navigation, settings, access and native dispatch.
- [x] T005 Export catalog seeding and derive ordered tenant migrations.
- [x] T006 Preserve migration parity and historical checksums.

## Phase 3: independent module
- [x] T007 Add the SDK-only sample workspace package.
- [x] T008 Prove installation, gating, panel, route and migration execution.

## Phase 4: delivery
- [x] T009 Write architecture and first-module documentation.
- [x] T010 Run required proofs and scans, repeat timed-out tests once.
- [x] T011 Record ownership handoffs, grep counts and commit locally.

## Integration handoff outside this worktree ownership
- [x] T012 Wire installation control-plane migrations and catalog seeding into the installation/local setup owner paths.
- [x] T013 Wire the fleet dry-run planner to TENANT_MODULE_CATALOGS.
- [x] T014 Move remaining module-specific host adapters into module packages and reach zero grep matches.
- [x] T015 Package-build owner removes transpilePackages after built entrypoints and SQL assets are available.

T005 exports the registry-derived seeding helper. T012 is the separate caller
wiring, which the ownership rule requires handing to the integrator.

Wave 4 integration also adds packed-tarball installation proof in CI and error-level
runtime environment lint across packages and modules. See the integration review
for commands, failures, retries, exclusions and remaining external-service skips.
