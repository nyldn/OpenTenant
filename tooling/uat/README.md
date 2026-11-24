# UAT operator controls

Run commands over SSH from the worktree that owns the running stack. Keep the
manifest private. These controls require the manifest, controller process and
control token to belong to this worktree and run. Every URL must use loopback.
The database must be the running, run/worktree-labelled, network-isolated
`pgvector/pgvector:0.8.2-pg17-bookworm` container. Service Postgres is refused.
The gateway serializes controls against reset. Receipts contain no credentials.

```sh
pnpm uat:control --help
pnpm uat:control status
pnpm uat:control fail-next-provision
# In the browser create slug uat-provision-retry, any synthetic owner email,
# a synthetic display name, and data region eu. Wait for Retry job to appear.
pnpm uat:control status
pnpm uat:control clear
# Click Retry job in the product. Wait for active/completed.
pnpm uat:control status
```

`fail-next-provision [slug]` accepts an optional NEW synthetic slug. It refuses
existing tenants/databases and an already armed conflict. It creates the tenant
database through the real Postgres provisioner, then a deliberately incompatible
`public.schema_migrations` table. The product's real migration reader fails and
its normal bounded attempts reach failed. No application or worker flags change.
The conflict stays until `clear`, so testers can observe the failure. `clear`
removes only that exact table, preserving the product's checkpoints and job.
The product owns retry and successful provisioning. If the tenant was never
created, `clear` removes the unused fixture database instead. Clear is idempotent.

For Journey 5, create an export in the product and confirm its download works.
Run `pnpm uat:control expire-exports <tenant-slug>`, for example
`pnpm uat:control expire-exports alpha`. The receipt reports the tenant slug and
number of existing archives updated. Retry the same download URL. The product
returns 404 through its normal expired-download denial path. Other tenants'
exports keep their expiry. An unknown slug is refused; an existing tenant with
no archives returns zero. Repeating the command leaves past expiries in the
past. It changes only `tenant_export_archives.expires_at` in the disposable
control database, preserving archives, jobs and product behavior. New exports
retain the product's normal 24-hour expiry. Reset removes test-created exports.

`pnpm uat:reset` restores the exact snapshot, removes control records and unused
fixture databases, and resets private brand-asset metadata and bytes. Reopen the
private persona links to reset their Assessment browser storage. No control
contacts a hosted service or changes production code. An older running stack
without worktree/run ownership records must be restarted by its owner before
these commands can be used. Never stop a stack owned by another worktree.
