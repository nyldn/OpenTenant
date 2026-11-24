# Neon tenant provisioning live probe

Date: 2026-07-20

The owner approved the United States for Neon development and named an
owner-controlled domain as the synthetic test-tenant identity. The probe used
the existing ignored development credential, the account's existing free
plan, and a hard zero-incremental-spend boundary. No credential, organization identifier,
project identifier, endpoint, or connection URI is recorded here.

## Scope

- One temporary Neon project at a time, named with the sanitized deterministic
  `opentenant-tenant-demo-*` prefix and placed in `aws-us-east-1`.
- Synthetic tenant and organization identifiers only. No genuine application
  or customer data was read, copied, or written.
- The repository's real `NeonProvisioner`, `provisionTenant()`, tenant-core
  migration, and `createAppRole()` boundaries.
- Project deletion after every attempt, followed by active and recoverable
  project inventory.
- No WorkOS organization, Vercel project/deployment, DNS record, custom-domain
  registration, or production setting.

The account inventory returned HTTP 200, plan `free`, and zero active projects
before the exercise. Neon documents that project creation is constrained by
plan limits and that non-idempotent requests must not be retried blindly; the
probe therefore used unique names and one create request per attempt.

## Provisioning and isolation evidence

The qualifying Node.js `v22.23.1` run passed the following checks:

- project creation selected `aws-us-east-1` and PostgreSQL 17;
- tenant-core migrations committed one exact synthetic tenant anchor;
- `tenant_app` could log in but had no `BYPASSRLS`, superuser, database-create,
  role-create, or replication privilege;
- both tenant-core tables had row-level security enabled and forced;
- `tenant_app` returned zero rows without transaction-local tenant context;
- the exact tenant context returned only the expected tenant, organization,
  and `us` region; and
- project deletion succeeded and the active-project inventory returned zero.

An earlier otherwise-passing cycle inherited Node 26 from the package-runner
PATH and is not counted as the qualifying runtime proof. Both cycles were
deleted.

## Verified TLS hardening

The live connection exposed a dependency warning: pg v8 treats
`sslmode=require` as hostname-verifying TLS, while its announced v9 behavior
will follow libpq's weaker `require` semantics. OpenTenant now normalizes every
fresh and resume-path Neon URI to `sslmode=verify-full` at the adapter boundary,
preserves other provider parameters, and rejects malformed URIs with a generic
error that cannot echo credentials.

Behavioral tests first reproduced the weaker URI unchanged, then passed after
the fix. A final Node 22 live project connected with `verify-full`; the client
TLS socket reported encryption and a real query succeeded without the earlier
warning.

## Cleanup and residual state

Final Neon API readback found:

- active projects: zero;
- active OpenTenant probe projects: zero;
- deleted provisioning probes in Neon's recoverable view: two;
- deleted TLS probes in Neon's recoverable view: four; and
- region for every recoverable probe: `aws-us-east-1`.

The recoverable entries are provider-retained deletion records, not active
projects. OpenTenant did not restore them or attempt an undocumented permanent
purge. Their provider-managed expiry remains to be observed before production
deletion evidence is approved.

## Domain boundary

Read-only DNS and HTTP checks found both owner-controlled domains already
serving live sites through external hosting providers. The owner's approval
allows one namespace for OpenTenant testing and the other as the synthetic
test-tenant identity; it does not justify reassigning either live apex. A
dedicated OpenTenant subdomain, DNS change, Vercel project binding, WorkOS
callback, and verification readback are required before hosted custom-domain
activation.

## References

- [Neon create-project API](https://api-docs.neon.tech/reference/createproject)
- [Neon list-projects API](https://api-docs.neon.tech/reference/listprojects)
- [Vercel REST API](https://vercel.com/docs/rest-api)
