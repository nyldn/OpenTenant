# Authorization

OpenTenant owns permission policy. Identity providers authenticate users and
supply tenant-scoped claims; they cannot add permissions to a mapped module.
`@opentenant/authz` exposes `AuthorizationPort`, with an in-process default and
an optional Apache-2.0 OpenFGA SDK adapter. This is local implementation and
container-test capability, not production enablement.

## Decisions

`listPermissions({tenantId, userId, moduleKey})` intersects live tenant module
entitlement, live membership roles, the manifest's declared permissions, and
`rolePermissions`. Claims, when supplied, further restrict elevated permissions.
Base `.use` still requires the role map but does not require an IdP claim, which
preserves access for roles without configured provider permission slugs. An
absent claim restriction lets the map decide; an empty array denies elevation.
`check` takes a fully qualified permission as `relation` and a structured object
`{tenantId, moduleKey}`. A mismatched object tenant is denied.

```ts
const manifest = {
  key: "example",
  version: "1.0.0",
  runtime: "remote",
  navigation: [],
  permissions: ["example.use", "example.edit"],
  rolePermissions: {
    tenant_owner: ["example.use", "example.edit"],
    tenant_admin: ["example.use", "example.edit"],
    tenant_member: ["example.use"],
  },
} satisfies ModuleManifest;
```

Every new module should declare `rolePermissions`, even `{}` to deny all.
Built-in manifests and migration 0063 supply maps for Assessment, Brain and
Support. Owners/admins can receive each module's declared elevated permissions
only when claims also contain them; members receive base use. Existing built-in
modules adopt this ceiling on upgrade. This deliberately closes the forged
claim gap for those modules as well as new installs.

Omitting `rolePermissions` is an explicit legacy compatibility path. It retains
base use plus syntactically valid module-prefixed claims, including undeclared
claims. NULL catalog snapshots also select that path. This exception avoids
silently breaking third-party modules with provider-managed permission lists;
it does not offer the mapped policy's security guarantee. Migrate those modules
by publishing reviewed maps. An empty map never selects legacy behavior.
OpenFGA entitlement sync requires a mapped manifest, so unmigrated legacy
modules are denied with that provider.

Reads return `false` or `[]` on context/provider errors, malformed input, or a
whole-operation deadline of 1500ms. Sync returns `false` on failure and must be
retried. The SDK has its own HTTP timeout and disables automatic retries.
OpenFGA checks use higher consistency. A timed-out mutation has an unknown
remote outcome; do not acknowledge sync until replay succeeds.

## Platform integration

`resolvePermissions` reads `tenant_modules.enabled` joined to
`module_catalog.authorization_manifest`. Missing or disabled rows, failed or
stalled reads, expired sessions and missing active roles deny access. The
function retains the established cross-tenant platform-admin base-use path,
with entitlement and mapped member-role checks and no home-tenant claims.
OpenFGA additionally requires that principal's target-tenant membership tuples;
installation admin status never creates a global OpenFGA grant.

Only this resolver is connected here. Settings guards, tenant resolution,
provisioning, identity adapters, and domain pages are unchanged. Callers still
own their route admission and managed-support checks.

## OpenFGA configuration and model

`AUTHZ_PROVIDER` defaults to `in-process`. To opt in set:

- `AUTHZ_PROVIDER=openfga`
- `OPENFGA_API_URL`, `OPENFGA_STORE_ID`, `OPENFGA_MODEL_ID`
- Optional `OPENFGA_API_TOKEN`, kept outside the database

Unknown or incomplete provider configuration denies resolver access. The
composition root lazily imports the SDK. Each call pins the model ID; it never
selects the latest model implicitly. Migration 0063 also creates an optional
`authorization_provider_config` table for installation-bound IDs. Environment
configuration is the implemented source; table loading is a future composition
choice and is not silently mixed with environment values.

The canonical model is `packages/authz/model/authorization.fga`. Tests compile
that actual DSL with the Apache-2.0 OpenFGA syntax transformer and submit it to
the real server. The five types are installation, tenant, member, module and
permission. Installation is metadata with no grant relation. Tenant owns role
memberships; each member, module and permission object ID embeds its tenant.
A permission's `granted` relation intersects role membership and module access;
module access intersects its tenant's active members and entitlement gate.

The adapter only accepts structured tenant-scoped membership and entitlement
relationships. It constructs all tuples itself, preventing cross-tenant
edges. Raw OpenFGA administrative credentials can bypass this invariant and
must be reserved for the trusted adapter/operator. The model does not itself
compare object-ID prefixes. Use a separate store per installation and deny
untrusted callers direct write access.

For disposable local development:

```sh
docker compose --profile authz up -d openfga
```

The profile pins `openfga/openfga:v1.11.0` by digest, uses an in-memory store,
and binds only loopback port 58080. Create a store and publish the checked-in
DSL through the SDK/operator tooling, then configure the returned IDs. Store
creation and model publication are intentionally not automatic on requests.
Use a persistent OpenFGA datastore and authenticated private endpoint for an
operator-approved deployment. No production deployment is included here.

## Relationship sync wiring

`syncMembership` and `syncEntitlement` call only the port. They are exported
without wiring into another owner's routes. Duplicate writes and missing
deletes are server-side no-ops. Role changes delete other roles before granting
the replacement. Entitlement removal deletes the module gate, even if the
manifest changed since the original grant. The shared live policy also denies
stale grants removed from a manifest. Writes are atomic up to 100 generated
tuples; larger sync requests return false and need smaller module batches.

The integration owner must connect these points before enabling OpenFGA:

1. After committed identity membership creation, activation, role change,
   suspension or removal, enqueue `syncMembership` with normalized internal IDs.
2. After committed `tenant_modules` changes, enqueue `syncEntitlement` with the
   effective enabled state. Publish the reviewed module manifest snapshot in
   `module_catalog.authorization_manifest` on module registration/version change.
3. Bootstrap by replaying active memberships and enabled mapped entitlements.
   Consume a transactional outbox or reconcile from the authoritative tables;
   retry false results. Serialize membership events per tenant/user to avoid
   stale concurrent role writes. Never synchronize in a permission read.
4. On manifest changes, replay entitlement grants. Live manifest evaluation
   bounds stale stored grants immediately; removed tuple scaffolding can be
   cleaned up offline after the entitlement gate is closed.

The in-process adapter uses live context immediately. Once relationship sync is
used on an instance, its synced membership and entitlement sets also restrict
decisions. Keep that instance alive for in-memory sync consumers. The platform's
request-scoped adapter uses live context; it is not an event-sync cache.

## Verification

`authorizationConformance` is exported from `@opentenant/authz/testing`. The same
suite runs against both adapters. `pnpm --filter @opentenant/authz test` starts a
uniquely named Docker container on a random loopback port, compiles/publishes
the DSL into fresh stores, and removes the container. Docker is required; the
suite fails rather than skipping. Additional tests cover two entitled tenants
and users, revocation, provider failure, legacy policy and sync failures.

Dependencies are pinned in the package and lockfile. The SDK, syntax transformer
and server are Apache-2.0, used as dependencies rather than copied source.
