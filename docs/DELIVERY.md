# Delivery contract

Use Node 22 and the pnpm version pinned by `packageManager` in the root
`package.json`. Run checks from a frozen lockfile. A passing cached task is not
current evidence when a milestone or release packet requires a fresh run.

## Checks by change type

Every code or configuration change must pass:

```bash
pnpm install --frozen-lockfile
pnpm quality:matrix
pnpm check
pnpm build
git diff --check
graphify check-update .
```

Dependency changes must also pass:

```bash
pnpm audit --prod --audit-level high
pnpm --dir templates/tenant-module-nextjs install --frozen-lockfile
pnpm --dir templates/tenant-module-nextjs audit --prod --audit-level high
pnpm --dir templates/tenant-module-nextjs build
```

Report every remaining audit finding by severity. An audit that exits 0 at the
high-severity threshold does not prove that the dependency tree has no lower
severity findings. Update each workspace policy and its lockfile together.

Database, migration, tenant-isolation, or store changes need executed
PostgreSQL 17 evidence from guarded synthetic databases. New fixtures use the
`opentenant_it_` prefix; existing suite-owned `opentenant_ops04_`,
`opentenant_ops05_`, and `opentenant_ops06_` guards remain valid. Run the
migration, `pnpm database:store-proof`, and `pnpm rls:proof` profiles in separate
disposable clusters when their role or fixture lifecycle can conflict. The
`database-store-proof`, `migration-execution`, and `rls-proof` CI jobs are the
canonical Linux executions. A missing URL, missing tool, skipped named suite,
or shared destructive fixture fails the database gate. Never use an application
or provider database for delivery verification.

User-facing behavior needs browser evidence for the changed journey, including
the relevant narrow and wide layouts, keyboard use, visible failure states,
persistence, and downloaded artifacts. Use synthetic provider responses unless
a live call has separate authorization.

## Delivery record

Record exact commands, exit codes, executed and skipped tests, browser or
database evidence, and unresolved external dependencies in the task review.
Keep release, provider, database, identity, and production actions behind their
separate owner gates.

## Before public visibility

Run the [repository privacy check](tooling/local-workspace.md) and redacted
Gitleaks over the refs that will be published. Review commit metadata,
ever-tracked paths, and generated artifacts. Review
provider identifiers, real email addresses, deployment URLs, tenant data, and
security boundaries separately; a passing secret scan does not cover them.
Include public-facing GitHub PR, issue, comment, and Actions records in the
review. Repeat the checks on the final revision after any history cleanup.
Record the result in a dated review and obtain explicit owner approval for
the visibility change. Track contribution, release, and provenance decisions
in [owner tasks](OWNER-TASKS.md).
