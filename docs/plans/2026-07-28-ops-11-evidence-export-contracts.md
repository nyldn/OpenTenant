# OPS-11 compliance evidence export contracts plan

## Boundary

Implement provider-independent local contracts only. The slice does not call a
provider, name a provider contract, process genuine tenant data, or claim SOC 2
compliance, audit readiness, certification, or Vanta readiness.

## Contract

1. Define immutable, digest-bound scope versions for either:
   - one exact tenant; or
   - an installation-owner aggregate with an explicit frozen tenant allowlist.
2. Require a new, separately consented version to add any tenant, resource
   type, field, purpose, region, aggregation rule, or retention.
3. Require explicit allow authorization and an exact active scope version for
   every export.
4. Bound every request by time window and record count. Project only allowlisted
   fields and report omitted fields as redacted without returning their values.
5. Bind the exported manifest to connection, scope version, tenants, request,
   records, prior digest, and current digest so it can be verified offline.
6. Make revocation one-way and immediate, make job submission idempotent, and
   expose checkpoint reconciliation without treating the adapter as canonical.

## Test-first sequence

1. Add public-entry tests for authorization, bounds, tenant/resource/field
   denial, redaction, immutable versions, integrity verification, revocation,
   idempotency, and reconciliation.
2. Run the focused test and record the expected missing-contract RED.
3. Implement the smallest contract and synthetic adapter that makes the tests
   pass.
4. Run focused tests and direct package typecheck without cache writes.
5. Update durable delivery records and set OPS-11 to `not_verified`. The
   external controller owns the full verification profile, Graphify refresh,
   checkpoint, and completion promotion.
