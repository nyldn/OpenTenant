# Feature specification: installed module registry

Feature branch: current fix-wave-4 worktree
Created: 2026-11-11
Status: Integrated in wave 4; see the wave-4 verification record

## User scenarios and testing

### User story 1: install a module (P1)
An operator adds a dependency and one entry in the host composition. The host
finds its navigation, native routes, settings panels, permissions and migrations.
Acceptance: an independent SDK-only sample executes through the same registry
without modifying host algorithms. A disabled entitlement denies its route.

### User story 2: retain existing modules (P1)
Existing native modules keep their stable keys, routes, role ceilings and SQL
checksums. Tenant provisioning and fleet migration consume the same ordered
registry catalog. Acceptance: disk/catalog parity and checksum tests pass.

### User story 3: administer installed modules (P2)
Tenant administrators see every installed module and editable navigation item.
Presentation overrides never grant entitlement or permission.

## Requirements

- FR-001: provide defineModule and defineModules with duplicate and contract validation.
- FR-002: use a single host composition for installed definitions.
- FR-003: derive navigation, native entitlement checks, settings, catalog seed
  records and native dispatch from those definitions.
- FR-004: keep tenant migration ordering and historical SQL bytes unchanged.
- FR-005: reject unknown modules, duplicate routes, undeclared permissions and
  cross-tenant sessions. Route authorization must precede rendering.
- FR-006: document the SDK contract and package build handoff.

## Success criteria

The sample's route, panel, navigation, authorization and actual SQL migration
pass a CI-friendly installation test. Required repository and database proofs
are recorded with failures and skips. References outside assigned ownership
are inventoried for the integrator rather than silently counted as removed.

## Constraints

Do not edit other owners' package build/export/private fields, Next configuration,
CI, e2e tooling or MCP routes. No push or PR. No control-plane schema change is
planned. Existing module-specific host adapters outside ownership need follow-up.

## Provenance

The specification follows github/spec-kit (MIT) document structure. The module
registration design follows Backstage backend-plugin-api (Apache-2.0) extension
registration ideas. No third-party implementation code is copied.
