# Installed module registry

`apps/platform/opentenant-modules.ts` is the installation composition. It lists
Assessment, Brain and Support in their historical tenant migration order.
Each definition contains its manifest, native routes, settings and admin panels,
control-plane and tenant migrations, permission role maps, catalog defaults,
export schemas, configuration names and optional operator service bindings.
The SDK validates and freezes these contributions with `defineModule` and
`defineModules`. There is no process-global self-registration.

## Consumers

- Optional navigation `headerLabel` values contribute authorized header shortcuts.
  The existing help shortcut is declared by its module.
- The tenant home derives navigation from installed definitions, live
  entitlements, authorization results and existing presentation overrides.
- Navigation settings iterates installed items. Its mutation route rejects
  unknown IDs and edits to fields the manifest does not mark configurable.
- Module settings iterates installed definitions and renders authorized panels.
  Shared-code configuration requires an explicit module permission grant.
- The generic native catch-all resolves registered exact or parameterized paths, verifies the
  tenant's identity or shared-code grant, resolves permissions through the
  existing authorization port, then calls `dispatchNativeModule`.
- Native entitlement lookup requires an installed native definition. Database
  entitlements can disable it. Platform defaults must also agree with the
  installed definition. Installed role maps cap authorization even if a stale
  database snapshot lacks a role map.
- `tooling/migrations/src/tenant-modules.ts` derives ordered catalogs from the
  composition. Provisioning calls its existing `migrateTenantModules` helper.
  SQL assets, IDs, checksums and the core-before-module ordering remain intact.
- `seedModuleCatalog` derives new catalog rows and immutable version records
  from the registry. It must run in the caller's control-plane transaction.
  It does not overwrite existing ownership or tenant assignments. The
  `legacy_identity` digest explicitly records identity, not an artifact proof.

## Independent installation proof

`examples/module-hello` imports only `@opentenant/module-sdk`. It builds ESM and
TypeScript declarations, ships its SQL, and passes the same publint, ATTW,
licence and tarball checks as the public libraries. No `transpilePackages`
configuration is needed.

Run `pnpm module:adopter-proof`. The disposable database harness wraps a script
that packs Hello, adds the tarball to a temporary copy of the host, changes
exactly one composition line, installs the workspace and builds the host.
The test then executes the actual Next page and navigation loader against a
real seeded installation catalog. It disables the entitlement in PostgreSQL,
proves route denial and hidden navigation, applies the packed SQL, checks
restricted-role isolation, and replays without drift. The script compares every
pre-existing host source file against its initial copy. Only the dependency
manifest and composition may differ.

Before publication, the proof supplies the sample's SDK dependency as a second
packed tarball through a temporary scoped override. Neither tarball resolves
SDK source exports. The temporary installation may download public npm packages;
it never publishes packages or contacts a hosted tenant/provider.

The existing in-process tests additionally cover settings panels, role ceilings
and cross-tenant principals. The SDK README contains the
[authoring guide](../../packages/module-sdk/README.md).

## Installation and boundaries

The local and hosted installation commands apply platform schema migrations,
then module control-plane catalogs, and seed new catalog/version records in a
transaction. Local tenant entitlements and policies derive from installed
definitions. Hosted fleet dry-runs and applies use the same registry catalogs
after tenant core. Legacy built-in catalog aliases and the Assessment access
adapter have been removed.

Built-in pages and APIs now live in their module packages. The host dispatches
native routes and API contributions, supplies shared platform ports, and clears
cookies for every installed module at logout. Configuration passed to a module
contains only that module's declared keys. Operator helpdesk data sources are
bound explicitly in the composition. Tenant exports enumerate module-declared
schemas. Brain reuses the platform's OAuth vault AAD helper.

`pnpm module:audit` enforces the documented case-sensitive special-case search.
The app audit starts at 150 matching lines, following the registry branch's
172-to-151 reduction and removal of one Next configuration match. It ends at
zero after six documented exclusions: five installation operator-support rate
budget lines and one package dependency declaration. The extended audit finds
20 more matching lines in shared runtime packages and reduces those to zero
with one additional shared rate-budget type exclusion. All seven exclusions
have runtime comments or a composition comment explaining metadata.

Telemetry schemas live with their module definitions. Local identity receives
registry-derived permission defaults. The Better Auth HTTP adapter receives
installed access-cookie names from the host. Tenant activity receives the
installed navigation IDs and keeps all other metadata default-deny. Shared
packages contain no native-module selection.

Module manifests and SDK entrypoints resolve through built ESM and declaration
exports. The package build compiles SQL imports to ESM text and ships the
original SQL assets. Package checks compare all 55 historical IDs and checksums
against the immutable pre-build fixture. The Hello migration retains its own
namespace and bytes. Generated graph output is not committed.

Historical migration SQL stays immutable even where it contains old module
seeds. Those applied migrations are upgrade history, not a new discovery API.

## Design provenance

The API uses the explicit registration and extension contribution pattern of
Backstage backend-plugin-api, Apache-2.0. The spec/plan/tasks documents follow
spec-kit's MIT document organization. No vendor implementation was copied.
