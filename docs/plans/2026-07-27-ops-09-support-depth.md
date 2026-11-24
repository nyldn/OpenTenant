# OPS-09 support depth and delivery contracts

## Scope

Implement the ninth multi-tenant operations slice without provider calls:

- canonical, tenant-bound in-app and email preferences and delivery attempts;
- opaque destination references and deterministic idempotency;
- attachment metadata and access authorization without attachment bytes;
- deterministic SLA clocks, requester-owned CSAT, and content-free analytics;
- explicit requester, tenant-admin, installation-owner, and managed-support
  authorization with tenant denial and canonical audit evidence.

Live email providers, object storage, upload UI, Slack OAuth/actions, genuine
tenant data, and cross-tenant analytics are excluded.

## Test-first sequence

1. Add public contract tests that initially fail because the support-depth
   module does not exist.
2. Implement an injected canonical store and no-network synthetic delivery
   transport, preserving append-only attempts and evidence while normalising
   provider failures and bounding transient retry.
3. Add the tenant-support migration with RLS, tenant/ticket foreign keys,
   canonical outbox-version binding, validated retry chains, persisted SLA
   pause state, immutable identity fields, safe-reference constraints, and
   bounded values.
4. Run focused support tests, direct type checking, and disposable loopback
   PostgreSQL proof, then update durable records and leave the unattended
   backlog at `not_verified`.
