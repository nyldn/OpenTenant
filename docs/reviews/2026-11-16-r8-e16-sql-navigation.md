# R8 E16 SQL navigation receipt

Base: `41adc71`. Local preparation only. Marketing impact: none.

The local tools are Node 22.23.2, pnpm 11.13.1, locked TypeScript 5.9.3,
Graphify 0.9.111 and tree-sitter 0.25.2. Neither tree-sitter-sql nor a
SQL language pack is installed. No dependency or global tooling was added.
The supported navigation workaround uses TypeScript AST string discovery and
an original bounded lexical SQL scanner. It does not claim SQL grammar support.

`graphify update .` passed with 9,462 nodes and 22,034 edges before the overlay.
It reported 63 SQL files skipped for missing grammar, 164 files with no
symbols, 24 unclassified files, and nine missing-source metadata warnings.
`node tooling/graphify/sql-navigation.mjs .` added 116 table definitions and
134 store references, with zero ambiguous references. It repaired nine
semantic nodes only after locating a cited document mention. Four other
semantic concepts remain without a qualifying mention. Import stubs without
source files remain external references. No invented provenance was assigned.

The known query connects `tooling/migrations/sql/control-plane/0001_init.sql`
CREATE TABLE `tenant_databases` at line 82 to the SQL literals in
`packages/database/src/credential-cipher-rotation.ts`, including the encrypted
connection update. The regression proof reads both source files and verifies
the definition line and relationship. `graphify path 'SQL table tenant_databases'
'SQL store credential-cipher-rotation.ts L66' --undirected` returns that direct
source-linked relationship. The relationship is labelled INFERRED.

The four regression cases passed under `forge-job run r8-sql-proof`.
Ripwire did not index the new tooling at the initial check; the executable proof and ESLint cover these scripts. SQL execution
is checked separately by the required disposable PostgreSQL 17 sequence.

Remaining limits are dynamic identifiers, procedural bodies, dialect syntax
and references outside the selected database stores. The upstream SQL grammar
warning remains true. Graph JSON is repaired; HTML and the report still need
integrator regeneration. Run the overlay after Graphify updates. No generated
graph is committed. See `tooling/graphify/README.md` for commands and scope.
