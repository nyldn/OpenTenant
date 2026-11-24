# Local SQL navigation

Run after the normal AST refresh, from the repository root:

```sh
graphify update .
node tooling/graphify/sql-navigation.mjs .
graphify path 'SQL table tenant_databases' 'SQL store credential-cipher-rotation.ts L66' --undirected
```

The local supported combination is Node 22.23.2, locked TypeScript 5.9.3,
Graphify 0.9.111 and tree-sitter 0.25.2. No SQL grammar is installed.
This script uses the existing development TypeScript parser to locate SQL
literals and a bounded lexical scanner for CREATE TABLE and table references.
It adds navigation, not SQL syntax validation. PostgreSQL 17 remains the
execution authority through `pnpm db:ephemeral -- pnpm ci:db-sequence`.
No runtime or development dependency was added, downloaded or copied.

Each added node and edge records a repository-relative source and line.
Definitions are EXTRACTED; migration-to-store relationships are INFERRED.
Procedural bodies, dynamic identifiers and ambiguous names are omitted.
Only database store files and the credential rotation store are linked today.
Repeated runs replace the overlay without duplicates. A normal Graphify update
can replace it; rerun this script afterward. Generated output stays uncommitted.
The integrator must regenerate the report and clustering if it needs these
nodes in the HTML/report too; this script repairs the queryable graph JSON.

Semantic nodes missing provenance gain a source only when an existing edge
cites a document containing their normalized label. The metadata explicitly
calls this a document mention, not a definition. Unresolved concepts remain
unresolved. The upstream warning is retained in the receipt.

Run the regression proof with `node --test tooling/graphify/sql-navigation.test.mjs`
inside the required `forge-job run` wrapper. It checks masking, idempotence,
metadata evidence and a migration-to-store path against the actual source.
