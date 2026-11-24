# OpenTenant module SDK

The Apache-2.0 SDK defines installed module contributions. A module imports
`defineModule` from `@opentenant/module-sdk`; the host calls `defineModules` once
in `apps/platform/opentenant-modules.ts`.

## Build your first module

Start with [the Hello example](../../examples/module-hello/src/index.js). It is
a separate workspace package and its implementation imports only the SDK.

```js
import { defineModule } from "@opentenant/module-sdk";

export const example = defineModule({
  manifest: {
    key: "example", version: "1.0.0", runtime: "native",
    navigation: [{ id: "example.home", defaultLabel: "Example", route: "/example",
      configurable: ["label", "order"], requiredPermission: "example.use" }],
    permissions: ["example.use"],
  },
  routes: [{ path: "/example", requiredPermission: "example.use",
    render: ({ tenantId }) => ({ title: "Example", body: `Tenant ${tenantId}` }) }],
  adminPages: [],
  settingsPanels: [],
  migrations: { controlPlane: [], tenant: [] },
  permissions: { declared: ["example.use"], roles: {
    tenant_owner: ["example.use"], tenant_admin: ["example.use"],
    tenant_member: ["example.use"],
  } },
  catalog: { displayName: "Example", enabledByDefault: false },
});
```

1. Give your package a unique name and stable manifest key. Ship executable
   JavaScript with declarations. The Hello package uses plain ESM JavaScript,
   so it needs no Next.js `transpilePackages` entry.
2. Declare every route and its required permission. Renderers can return the
   SDK's `{ title, body }` page shape; a React host can also accept React nodes.
   Renderers receive a server-verified tenant, principal and permission set.
3. Declare settings panels and administration panels with stable IDs and
   required permissions. The module settings page renders them only for an
   entitled principal with that permission.
4. Declare ordered migrations as `{ id, sql }` records, with IDs such as
   `tenant-example/0001_init`. Keep SQL immutable after application. Enable and
   force tenant RLS, bind policies to `app.tenant_id`, and grant only necessary
   privileges to `tenant_app`. The migration runner owns transactions.
5. Add the package dependency to the host, then import its definition and add
   it to `defineModules([...])` in the composition file. This is the complete
   source change needed to install the Hello example. Enabling it for a tenant
   remains an explicit entitlement operation.
6. Run the normal installation catalog registration in a control-plane
   transaction and apply tenant migrations. `seedModuleCatalog` in
   `@opentenant/platform-core` and `seedInstalledModuleCatalog` in the host
   export these operations. See the architecture guide's remaining integration
   wiring before relying on automatic installation in this branch.

`permissions.roles` is authoritative. Registration puts the role ceiling into
`manifest.rolePermissions`; IdP claims cannot exceed that ceiling. Shared-code
access is disabled unless the module explicitly declares `permissions.passcode`.
A hidden navigation item still has its server-side access checks.

`defineModules` rejects duplicate keys, routes, navigation IDs, panel IDs and
migration IDs. `defineModule` rejects undeclared contribution permissions,
invalid route paths and unordered migrations. Registry snapshots are frozen.

## Verification

The platform's `lib/module-third-party-access.test.tsx` tests the actual native
page, settings page and navigation with a copy of the composition containing
Hello. It also checks entitlement denial, cross-tenant denial and role ceilings.
`lib/module-installation.test.ts` extends a copy of the production
composition with Hello and exercises the production navigation and dispatch
functions. `tooling/migrations/src/module-installation.integration.test.ts`
executes its SQL, tests cross-tenant RLS and checks idempotent migration replay.
Run it with `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test`.

The extension registration design takes ideas from Backstage's
[backend plugin API](https://backstage.io/docs/backend-system/architecture/plugins/),
licensed Apache-2.0. No implementation code is copied.
