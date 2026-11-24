# Hosted production deployment

OpenTenant has no configured production account. This runbook applies only
after the owner approves a specific provider account, project, domains, data
region, cost envelope, and release. Provider identifiers are supplied at
runtime and must never be committed. For Vercel, use REST APIs only.

## Preconditions

- CI and the accepted preview are green for `RELEASE_SHA`.
- Product acceptance is signed and dated by the named release owner.
- Migrations passed drift, canary, tenant-isolation, backup, and restore gates.
- Identity, database, and deployment resources all belong to the approved
  environment; staging and production identifiers are never mixed.
- `ROLLBACK_DEPLOYMENT_ID`, `PRODUCTION_ALIASES`, the rollback window, and the
  incident lead are recorded before promotion.
- Environment configuration was audited by name and target without retrieving
  or recording decrypted values.

## Promotion and domain gate

Confirm `DEPLOYMENT_ID` belongs to `VERCEL_PROJECT_ID`, is `READY`, and contains
the reviewed Git revision. Promote it through the provider REST API using the
runtime `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_API_KEY` values.

Domain or DNS changes require separate written approval. Before approval, do
not add, move, verify, alias, or edit any domain. After approval, record the
pre-change DNS and alias state, ensure both owners are present during the
rollback window, and verify `/api/health`, `/assessment`, sign-in and sign-out,
tenant entitlements, and telemetry on every promoted alias.

Monitor errors, latency, identity failures, tenant-mismatch events, database
health, and AI readout failures throughout the rollback window. Do not delete
the previous deployment. On an isolation, authentication, acceptance, or
data-integrity failure, follow `rollback.md` and preserve evidence.
