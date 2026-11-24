# Wave 5 AI host settings

All settings are optional. Configure them through the installation's secret and
configuration manager. No environment file is created by this integration.
An absent provider group registers no hosted adapter. A partly configured group
fails startup with setting names only. Production has no synthetic or local
embedding fallback. Tenant routing, allowlists, residency, retention and consent
still gate every model operation. These settings make no live provider call.

Each configured chat group requires all six settings below. Endpoints require
HTTPS without userinfo, query strings or fragments. Models are exact identifiers.
Region is an operator residency assertion and must match the approved route.
Chat API keys remain in the existing encrypted tenant/installation credential
broker, including tenant-first lookup. No chat API key setting is introduced.

| Setting | Value |
| --- | --- |
| `MODEL_OPENAI_BASE_URL` | OpenAI-compatible API root, such as `https://models.example.test/v1` |
| `MODEL_OPENAI_MODEL` | Exact approved model identifier |
| `MODEL_OPENAI_REGION` | `us`, `eu` or `ap` |
| `MODEL_OPENAI_TIMEOUT_MS` | Integer from 1 through 300000 |
| `MODEL_OPENAI_MAX_OUTPUT_TOKENS` | Integer from 1 through 65536 |
| `MODEL_OPENAI_API_VERSION` | Exactly `v1` |
| `MODEL_ANTHROPIC_BASE_URL` | Anthropic-compatible API root, such as `https://models.example.test/v1` |
| `MODEL_ANTHROPIC_MODEL` | Exact approved model identifier |
| `MODEL_ANTHROPIC_REGION` | `us`, `eu` or `ap` |
| `MODEL_ANTHROPIC_TIMEOUT_MS` | Integer from 1 through 300000 |
| `MODEL_ANTHROPIC_MAX_OUTPUT_TOKENS` | Integer from 1 through 65536 |
| `MODEL_ANTHROPIC_API_VERSION` | Exactly `2023-06-01` |

Brain embedding configuration is a separate all-or-nothing group. The current
adapter requires 1536 dimensions. It has no output-token setting because an
embedding response has no generated output tokens. The HTTP request's abort
signal reaches the adapter. Omitting the group preserves production unavailability
and development/test deterministic embeddings under the existing local route.

| Setting | Value |
| --- | --- |
| `BRAIN_EMBEDDING_BASE_URL` | HTTPS OpenAI-compatible API root |
| `BRAIN_EMBEDDING_MODEL` | Exact approved embedding model identifier |
| `BRAIN_EMBEDDING_REGION` | `us`, `eu` or `ap` |
| `BRAIN_EMBEDDING_TIMEOUT_MS` | Integer from 1 through 300000 |
| `BRAIN_EMBEDDING_API_VERSION` | Exactly `v1` |
| `BRAIN_EMBEDDING_API_KEY` | Secret, nonblank, without CR/LF; never log it |

The typed embedding projection keeps the API key non-enumerable. Framework
build/routing projections omit it. Provider adapters normalize errors without
URLs, credentials, response bodies or causes. Do not log full server configuration.

## Support inference dependencies

The host resolves the authenticated tenant's `reviewed-suggestion` route through
the model router. Routed inference remains disabled. The router does not expose
independently recorded preparation identity, execution-parent linkage or recorded
consent basis required by `SupportAiInferencePort`. The host refuses to open a
provider stream and does not invent evidence from a region comparison.
R5 needs a recorded-evidence reader and the missing provenance fields before
this dependency can return an accepted attempt.

The host composes the existing `PgTenantVoiceProfileStore`. Its verified current
profile supplies only banned words, version and digest. Revoked or mismatched
profiles fail closed. There is no encrypted owner-only rejected-output quarantine
for Support with a maximum 24-hour TTL, so that dependency stays disabled and
returns a fixed error. Brain's quarantine is for another schema and purpose.
The explicit privileged tenant-local synthetic mode remains available through
R6's existing factory. Suggestion handlers receive no ticket mutator or sender.

## Support retention and ticket purge

`SUPPORT_AI_RETENTION_DATABASE_URLS` is an optional secret JSON object mapping
trusted tenant IDs to dedicated privileged PostgreSQL connection URLs. With no
mapping, the worker does no retention connection or queue work. Never use a
shared database or a tenant application login. Operators must grant only the
retention authority required by R6's purge function and its tables. The host
never grants it to `tenant_app` or derives these URLs from a request.

The worker dispatches at most 25 configured tenants each minute, with a rotating
cursor, one deduplicated job per tenant and normal tenant queue serialization.
Each purge uses one connection, a five-second SQL statement timeout and an
explicit tenant context. It locks the request/content tables and rejects visible
foreign-tenant requests before calling `support.purge_ai_suggestion_content()`.
The transaction removes expired content and content whose ticket was purged;
immutable evidence stays intact. A large purge that exceeds the time bound rolls
back and requires operator attention. The existing R6 function has no row-limit
parameter, so this integration bounds tenants and SQL time rather than row count.

The `support_ticket_purge` job and `purgeSupportAiTicketContent(tenantId)` worker
hook run the same check after a ticket purge. There is no existing individual
hard-ticket-delete scheduler to attach to; the minute reconciliation catches
missing tickets. Tenant hard erasure already deletes the entire tenant database.

## Quality evidence factory

`qualityContractBinding` composes `PgQualityContractStore` with the exported
persistence codec. E18 has no HTTP caller. A future trusted host caller must
supply a `TrustedQualityArtifactResolver` backed by verified artifact custody.
The factory hashes the actual bytes; it accepts no caller-provided digest,
tenant or actor. The database store rechecks exact tenant-private ownership,
installation identity and `sha256_artifact` registration on every access.

Each operation reloads the active tenant and authenticated, unexpired session,
then checks live module permissions. Reads require `module.dev.contract.read`
or `module.dev.evidence.read`; writes require `module.dev.contract.write` or
`module.dev.evidence.write`. Missing permissions, a missing artifact resolver,
platform-admin impersonation and cross-tenant artifacts fail closed. This slice
adds no permission grants or route. New write permissions remain unavailable
until an authorized module contract declares them. Dependency failures return
fixed persistence errors without logging artifacts or secrets.

Marketing impact: none.
