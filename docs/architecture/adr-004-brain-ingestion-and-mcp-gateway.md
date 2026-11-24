# ADR-004: Brain direct-ingestion boundary and MCP gateway

Status: accepted 2026-07-17

## Context

ADR-002 placed the brain inside the OpenTenant platform but assumed Fivetran-led
ingestion and no platform-managed MCP boundary. The frozen scaffold plan for
`modules/brain` changes both assumptions: sponsor-named sources are Slack,
Gmail, Drive, and Calendar; external CLI agents need a governed MCP entry
point that still trusts the platform's Ed25519 module-context contract.

## Decision

The brain remains a native platform module, but ingestion and agent access
move to platform-managed boundaries.

- **Direct connectors supersede ADR-002 ingestion.** The platform owns OAuth
  custody for Google and Slack connectors, runs incremental sync directly,
  and writes raw signals into the tenant-local brain schema. This supersedes
  ADR-002's Fivetran-first ingestion clause.
- **MCP stays additive, not a serving path.** The tenant-domain composition
  proxy (`/m/[module]`) remains the remote-module boundary from ADR-003. The
  brain adds a separate platform API route at `/api/mcp/brain` for external
  MCP clients. It verifies the same Ed25519 module context and never trusts
  ambient headers or provider sessions.
- **Identity is mandatory.** Brain MCP access rejects module contexts with
  `userId: null`. Passcode access remains available for remote composition
  generally, but not for brain ingestion or promotion because every action
  must be attributable to a user.
- **Promotion is deferred.** `brain.promote` and `brain.admin` permissions
  are reserved in the manifest, but grant resolution and write-path tools are
  follow-on work. The scaffold denies promote tools by construction.

## Open item

Service-principal issuance for long-lived external MCP clients is not
implemented in this scaffold. A follow-on design must define how non-browser
agents obtain refreshable credentials without weakening the signed
module-context boundary or bypassing user attribution.

### WP-A verification (2026-07-18)

WorkOS M2M applications are the chosen mechanism, verified live on staging:

- `POST /connect/applications` (`application_type: "m2m"`, org-scoped)
  creates the application; verified against the staging environment.
- `POST /connect/applications/{id}/client_secrets` issues the client
  secret, returned only at creation time; verified.
- Tokens come from the OAuth `client_credentials` grant at
  `POST /oauth2/token` on the environment's AuthKit domain (not
  api.workos.com; the domain is dashboard-visible only). Access tokens
  carry an `org_id` claim, giving per-tenant service principals that map
  onto the existing tenant-org resolution.
- Wiring plan: a `service_principal` variant of the module-context mint,
  where the platform validates the M2M JWT (environment JWKS), resolves
  `org_id` to a tenant, and mints the short-lived signed module context
  the MCP gateway already verifies. Attribution uses the application id
  as the actor. Blocked only on confirming the AuthKit domain from the
  dashboard.

## Consequences

- The control plane now stores encrypted OAuth tokens for connector custody,
  with AAD fixed to `oauth:${tenantId}:${provider}`.
- The tenant-local brain schema splits immutable raw-signal metadata from
  deletable payloads, so GDPR redaction deletes content while preserving the
  append-only provenance ledger.
- The platform can grow direct connector workers and search tooling without
  reopening the native-vs-remote module decision.
