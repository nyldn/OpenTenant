# ADR-002: Tenant knowledge as a native module

Status: accepted; connector implementation deferred

## Context

Tenants need a provenance-preserving knowledge spine that can ingest approved
signals, separate raw evidence from validated decisions, and return cited
answers through the application and MCP.

## Decision

The first knowledge implementation is a native module behind the standard
manifest, entitlement, permission, RLS, audit, and tenant-database contracts.
Its data remains tenant-local. Connector and model providers sit behind
interfaces; a module does not hold OAuth credentials or call the identity
provider directly.

## Consequences

- The module reuses platform security and operational controls.
- Provider-specific ingestion can evolve independently.
- A future remote implementation remains possible because its external
  contract is manifest, signed context, broker APIs, and evidence—not imports
  from the platform process.
