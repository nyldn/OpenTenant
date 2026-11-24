# ADR-003: Remote module composition

Status: accepted

## Context

Tenant-created and independently deployed modules cannot be compiled into the
trusted platform process. They still need tenant routing, branding,
entitlement, authorization, health, and rollback.

## Decision

Remote modules publish a versioned manifest and health endpoint. OpenTenant
registers an immutable version, composes it below `/m/<module>`, performs the
tenant and permission decision, and supplies a short-lived Ed25519-signed
module context. The module verifies the public signature and consumes narrow
broker APIs.

The signed context is bound to tenant, user, module key, permissions, brand,
issue time, and expiry. It is never a general platform session. Remote modules
do not receive control-plane, identity-provider, database, or deployment
credentials.

## Consequences

- Untrusted code stays outside the platform process.
- Each module can deploy and roll back independently.
- OpenTenant remains authoritative for tenant routing and entitlement.
- Provider URLs and IDs remain private deployment records, not module APIs.
