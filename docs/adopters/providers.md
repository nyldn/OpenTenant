# Provider choices

Choose one identity provider per installation. Optional adapters require explicit
configuration and deployment verification. Environment names below come from
[server-config.ts](../../apps/platform/lib/server-config.ts), except where a
separate operator process or constructor is cited.

## Identity

| Adapter | Selection and required configuration | Boundary |
| --- | --- | --- |
| Local | `IDENTITY_PROVIDER=local`; optional `LOCAL_PUBLIC_ORIGIN`, `LOCAL_TENANT_ID`, `LOCAL_USER_ID`, `LOCAL_SESSION_TOKEN`, `LOCAL_USERS` | Development only. Production rejects it. `LOCAL_USERS` entries bind each token to a tenant and role. |
| WorkOS | `IDENTITY_PROVIDER=workos`; `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI` | Hosted organizations and sessions behind `IdentityGateway`. Keep provider IDs in mapping stores. |
| Clerk | `IDENTITY_PROVIDER=clerk`; `CLERK_PUBLISHABLE_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_JWT_AUDIENCE` | Exact issuer, authorized party and audience verification; one provider for the installation. |
| Better Auth | `IDENTITY_PROVIDER=better-auth`; `BETTER_AUTH_SECRET`, `BETTER_AUTH_BASE_URL` | Self-hosted email/password and organizations. Production requires HTTPS and a secret of at least 32 characters. |

Source: [identity composition](../../apps/platform/lib/identity.ts),
[local](../../packages/auth/src/local/gateway.ts),
[WorkOS config](../../packages/auth/src/workos/sdk.ts),
[Clerk config](../../packages/auth/src/clerk/config.ts),
[Better Auth config](../../packages/auth-better-auth/src/config.ts).

Better Auth SSO and SCIM are opt-in through `BETTER_AUTH_SSO_ENABLED`,
`BETTER_AUTH_SSO_TRUSTED_ORIGINS` and `BETTER_AUTH_SCIM_CONNECTION`.
Their configuration does not prove an external IdP integration. See the
[adapter guide](../architecture/better-auth-adapter.md).

## Authorization

`AUTHZ_PROVIDER` selects `in-process` or `openfga`; the default is `in-process`.
The local adapter evaluates reviewed manifest role maps. OpenFGA requires
`OPENFGA_API_URL`, `OPENFGA_STORE_ID` and `OPENFGA_MODEL_ID`, with optional
`OPENFGA_API_TOKEN`. Publish the correct model and synchronize memberships and
entitlements before serving traffic. An unavailable configured adapter denies
access rather than falling back to a permissive decision.

Source: [provider factory](../../packages/authz/src/provider.ts),
[authorization architecture](../architecture/authorization.md).

## Provisioning

| Adapter | Configuration | Placement |
| --- | --- | --- |
| Operator Postgres | `PROVISIONING_PROVIDER=postgres`, `POSTGRES_ADMIN_DATABASE_URL`, optional `POSTGRES_TENANT_REGION` | One operator-owned server. The region string labels its placement; it does not route geography. |
| Neon | `PROVISIONING_PROVIDER=neon`, `NEON_API_KEY`, `NEON_ORG_ID` | One hosted project per tenant. Current mappings accept `us` and `eu`. |

Both use the canonical tenant migration path and encrypted runtime connection
records. Supply `TENANT_DB_ENCRYPTION_KEYS` and
`TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID`, or the legacy
`TENANT_DB_ENCRYPTION_KEY`. Production requires an explicit provisioning
provider. Source: [composition](../../apps/platform/lib/provisioning.ts),
[Postgres](../../tooling/provisioning/src/postgres.ts),
[Neon](../../tooling/provisioning/src/neon.ts),
[keyring parser](../../packages/database/src/credential-config.ts).

## Sandboxes

The optional factory supports `SANDBOX_PROVIDER=e2b` with `E2B_API_KEY`, or
`SANDBOX_PROVIDER=microsandbox`. The caller must also inject the provider's
transport and reviewed policy. Merely setting an environment variable does not
activate a callable Developer MCP workflow. E2B execution needs hosted-provider
approval. Local microsandbox requires an approved cached image and deny-all
network policy; authenticated previews are unsupported there.

Source: [factory](../../packages/sandbox/src/providers/configured.ts),
[sandbox boundaries](../architecture/sandbox-providers.md).

## Usage export

The worker defaults to a private file sink. `USAGE_EXPORT_SINK=file` and
`USAGE_EXPORT_DIRECTORY` choose it explicitly. For OpenMeter, set
`USAGE_EXPORT_SINK=openmeter`, `OPENMETER_INGEST_URL` and `OPENMETER_API_KEY`.
When both OpenMeter values exist and no sink is selected, the worker selects
OpenMeter. Export uses CloudEvents and durable receipts; the ledger remains
the source of truth. Billing policy is separate.

Source: [worker composition](../../apps/platform/workflows/usage-export.ts),
[export job](../../packages/usage-export/src/job.ts).

## Email

Identity mail uses `IDENTITY_SMTP_HOST`, `IDENTITY_SMTP_PORT`,
`IDENTITY_SMTP_FROM`, and optional `IDENTITY_SMTP_USER` /
`IDENTITY_SMTP_PASSWORD`. No identity transport is created without the host.
Port 465 uses direct TLS; production requires TLS.

Support email has a durable PostgreSQL delivery store and worker composition,
with typed SMTP options. In-memory helpers remain library test implementations.
The [V1 receipt](../../tooling/ci/db-sequence-inventory.md) executes eight delivery
cases without skips; the [wave-5 browser receipt](wave5-wiring-verification.md)
includes restart/retry behavior. Neither proves production deliverability. Source:
[identity mail](../../apps/platform/lib/identity.ts),
[SMTP adapter](../../packages/notifications/src/smtp.ts),
[support email procedure](../runbooks/transactional-email.md).

## Model providers

Wave-5 R5 implements OpenAI-compatible and Anthropic-compatible chat plus
OpenAI-compatible embeddings behind tenant-policy ports. Optional typed host
configuration is documented in [AI host settings](wave5-ai-wiring.md). Chat keys
remain in the encrypted credential broker. An absent provider configuration
registers no hosted adapter; production never falls back to synthetic chat or
token hashing. The [verification receipt](wave5-wiring-verification.md) uses
synthetic HTTP fixtures, with no live model-provider validation. Vercel AI
Gateway has no separate proven adapter.

Reconciled 2026-11-17 against existing receipts. Marketing impact: none.
