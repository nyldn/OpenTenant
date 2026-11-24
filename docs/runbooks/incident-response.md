# Incident response

This runbook covers OpenTenant and its configured deployment, identity,
database, and sandbox adapters. Account and resource IDs come from the affected
runtime environment; no provider account is canonical.

## Severity

| Level | Definition | Examples |
| --- | --- | --- |
| SEV1 | Active confidentiality, integrity, or platform-wide outage | Cross-tenant access, credential exposure, destructive data event |
| SEV2 | One tenant unavailable or major production function impaired | RLS failure contained to one project, auth outage, AI route broadly failing |
| SEV3 | Degraded service with a workaround and no data risk | Export failure, elevated latency, partial provider outage |
| SEV4 | Low-impact defect or operational question | Cosmetic issue, isolated telemetry rejection |

Treat any suspected cross-tenant access as SEV1 until disproved.

## First 15 minutes

1. Declare severity, incident lead, scribe, UTC start time, and affected tenant
   IDs or hosts. Do not place names, answers, prompts, or secrets in chat.
2. Freeze deployments, migrations, provisioning, domain changes, and key
   rotation unless they are the chosen containment action.
3. Record Vercel deployment ID, Git SHA, aliases, selected identity-provider
   environment, Neon project IDs, first symptom, and detection source.
4. Preserve evidence before rollback or restart. Capture response headers,
   sanitized logs, audit event sequence, and relevant Neon operations.
5. Bound impact by tenant, host, route, identity organization, region, and
   time. Check `/api/health`, `/assessment`, `/api/telemetry`, and provider status.
6. Contain. For tenant isolation risk, deactivate the affected domain or
   suspend the tenant through the approved control-plane path. For release
   regression, follow `rollback.md`.
7. Notify the security and client communications owners for SEV1 or SEV2.

## Tenant-isolation triage

For a host mismatch, compare these authoritative mappings:

1. Normalize `Host`; malformed or unknown hosts must return generic 404.
2. `domains.host` must be verified, active, and map to one active tenant.
3. The selected provider's external organization must map through
   `identity_org_mappings` to that same tenant and provider.
4. A mismatch must fail closed and emit a content-free security event. Never
   accept `x-opentenant-*` request headers as trusted tenant identity.

Use parameterized read-only control-plane queries:

```bash
psql "$CONTROL_PLANE_DATABASE_URL" \
  --set=incident_host="$INCIDENT_HOST" --set=tenant_id="$INCIDENT_TENANT_ID" \
  -c "select d.host,d.tenant_id,d.verification,d.active,t.status from domains d join tenants t using (tenant_id) where d.host = :'incident_host' or d.tenant_id = :'tenant_id';" \
  -c "select tenant_id,provider,external_organization_id from identity_org_mappings where tenant_id = :'tenant_id';"
```

For suspected RLS failure, stop traffic to that tenant project and inspect as
owner. `tenant_app` must be login-capable but must not have bypass or elevated
role attributes:

```sql
select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication
from pg_roles where rolname = 'tenant_app';

select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'tenant_core' and c.relkind = 'r';

select schemaname, tablename, policyname, qual, with_check
from pg_policies where schemaname = 'tenant_core';
```

Missing `FORCE ROW LEVEL SECURITY`, a permissive wrong-tenant policy, owner
credentials in application traffic, or `rolbypassrls = true` is SEV1.

## Evidence preservation

- Save Vercel deployment metadata and build/runtime events through the REST
  API, with timestamps and request IDs.
- Export relevant append-only `audit_events` rows and Neon operation history.
- Record selected-provider event IDs and organization IDs, never tokens or
  session data.
- Preserve originals read-only, calculate SHA-256 hashes, and log collector,
  time, source, and every redaction. Restrict evidence access by least privilege.
- Do not delete deployments, branches, logs, or failed jobs before review.

## Recovery and review

Restore service only after containment and tenant-isolation checks pass. Monitor
through an explicit stability window. Within five business days, document the
timeline, impact, root cause, control failures, detection gap, evidence links,
client or regulatory decisions, and corrective owners with due dates. Add a
regression test and update this runbook when the response exposed a gap.
