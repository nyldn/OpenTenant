# Shared contracts and isolation proofs

`identityGatewayContract(name, createFixture)` registers the provider-neutral
IdentityGateway contract exported by `@opentenant/testing`. Supply a fresh
fixture on each call, an in-memory provider port, stable internal IDs, and
failure/foreign-subject/ambiguity controls. `mutable: false` verifies the
single-user local adapter's explicit rejection of directory mutations. No
adapter case skips. Provider ports return complete lists; their paging fakes
must record at least two page reads. The SDK pagination tests in `packages/auth`
separately verify the real WorkOS and Clerk pagination implementations.

Run contracts and the regression index with `pnpm --filter @opentenant/testing test`.
The DB fuzz suite skips in this general workspace run. Its dedicated command
requires loopback PostgreSQL and verifies all nine named tests, zero skips,
and a newly written JSON report:

```sh
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/postgres \
  node packages/testing/scripts/isolation-proof.mjs
```

Use only a disposable pgvector/PostgreSQL 17 cluster. The command recreates
`opentenant_it_fuzz_control`, `opentenant_it_fuzz_tenant` and
`opentenant_it_fuzz_other`. It uses production `provisionTenantProject`, faking
only the Neon API. Both tenants are provisioned separately. Support attacks also use tenant A's context on tenant B's runtime
connection to exercise RLS against real foreign rows. The canonical singleton
constraint prevents co-locating two tenants in one database. The fixture uses the latest generated `tenant_app` login for both local
endpoints because Postgres roles are cluster-wide; Neon projects have separate
clusters. No runtime privileges or RLS policies are modified by this suite.

Tenant-local store calls run with the production restricted runtime role.
Control-plane stores have no runtime grant, so the suite asserts PostgreSQL
permission denials for those calls and raw update/delete attempts. It also
runs successful control-plane calls on the trusted control-plane connection,
checking tenant-scoped reads, mismatched resource IDs and unchanged foreign
canaries. This proves the existing privilege boundary; it does not claim that
control-plane tables have RLS or that those stores accept an ambient tenant
context. Admission normalizes database denials to `invalid_request` by design.

Each of seven families runs 25 generated sequences, with all four operation
branches included in each sequence. Five additional sequences permute the
entire malformed-ID inventory. Fast-check shrinks failures and prints their
seed and replay path. Locally the default seed is random; set
`ISOLATION_FUZZ_SEED` to replay. CI pins `20261111`. Reports go to
`DATABASE_STORE_REPORT_DIRECTORY` or `/tmp/opentenant-isolation-proof`.

Fast-check 4.3.0 and its pure-rand 7.0.1 dependency are MIT licensed. They are
installed dependencies; no third-party source was copied.

CI checks the licenses of the introduced property-test dependency graph and
writes its CycloneDX SBOM with `scripts/dependency-proof.mjs`. This bounded
inventory covers fast-check and pure-rand, not the inherited workspace graph.
