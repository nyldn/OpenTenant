# OpenTenant documentation

This index is the stable entry point for repository knowledge. Documents are
grouped by the question they answer rather than by the tool that created them.

## Adopter guides

[Adopting OpenTenant](adopters/README.md) covers local setup, first tenant and
module, concepts, provider choices, operations, security and FAQ. Start there
when evaluating or installing the platform.

The [E11 reconciliation ledger](plans/2026-11-17-e11-reconciliation.md) indexes
current committed wave-5/6 evidence and its limits. It leaves wave-7 UAT/ECS
results pending integrator receipts. The
[wave 4b integration record](reviews/2026-11-11-integration-wave4b.md) retains
historical package, browser, database and timed-adopter results for its revision.

## Internal and reference documentation

The sections below retain architecture decisions, runbooks, delivery plans,
reviews and handoffs. Plans and historical verification records describe their
own revision; they are not adopter setup instructions.

## Choose your route

| If you want to understand… | Start with |
|---|---|
| What OpenTenant does and what is ready | [Platform capabilities](product/platform-capabilities.md) |
| What changed over time | [Human-readable changelog](../CHANGELOG.md) |
| How requests, identity, data, and modules fit together | [Platform architecture](architecture/platform-architecture.md) |
| How an owner manages tenants, support, modules, and compliance | [Multi-tenant operations](architecture/multi-tenant-operations.md) |
| The exact current branch, checks, and next step | [Agent handoff](HANDOFF.md) |
| Detailed delivery and verification evidence | [Ship log](SHIPLOG.md) |
| Decisions or external actions still needed | [Owner tasks](OWNER-TASKS.md) |
| How to run or operate the platform | [Operations](#operations) |

## Start here

- [Platform capabilities](product/platform-capabilities.md): human-readable
  feature map, maturity, provider choices, and current limits.
- [Product requirement status](plans/product-requirements-status.md): local
  composition and remaining outcomes, with receipt-backed limits.
- [E11 reconciliation ledger](plans/2026-11-17-e11-reconciliation.md): stale
  claims, corrected scope and current evidence references.
- [Changelog](../CHANGELOG.md): the product story across development
  iterations.
- [Agent handoff](HANDOFF.md): current delivery state, priority, and verified
  next step.
- [Ship log](SHIPLOG.md): exact delivered capabilities and evidence by date.
- [Owner tasks](OWNER-TASKS.md): decisions and externally controlled actions.
- [Platform architecture](architecture/platform-architecture.md): accepted
  system boundary and end-to-end design.

## Architecture and decisions

- [Platform architecture](architecture/platform-architecture.md)
- [Multi-tenant owner, managed support, and module operations](architecture/multi-tenant-operations.md)
- [ADR-001: Monorepo and provider boundaries](architecture/adr-001-monorepo-foundation.md)
- [ADR-002: Tenant knowledge as a native module](architecture/adr-002-tenant-knowledge-module.md)
- [ADR-003: Remote module composition](architecture/adr-003-remote-module-consumption.md)
- [ADR-004: Brain ingestion and MCP gateway](architecture/adr-004-brain-ingestion-and-mcp-gateway.md)
- [ADR-005: Developer MCP sandbox adapter](architecture/adr-005-developer-mcp-sandbox-adapter.md)
- [ADR-006: Developer MCP authority and protocol baseline](architecture/adr-006-developer-mcp-protocol-baseline.md)
- [ADR-007: Durable work execution (proposed)](architecture/adr-007-durable-work-execution.md)
- [Sandbox providers and capability limits](architecture/sandbox-providers.md)
- [Usage export and worker wiring](architecture/usage-export.md)
- [Sandbox provider evidence](architecture/evidence/)

## Product and capability guides

- [Platform capabilities](product/platform-capabilities.md)
- [Tenant Module Developer MCP](product/developer-mcp.md)
- [Tenant module UI toolkit](product/module-ui.md)
- [Module Improvement Lab](product/2026-07-19-module-improvement-lab-prd.md)

## Delivery plans

- [Focused simplification implementation plan](superpowers/plans/2026-09-07-focused-simplification.md)
- [2026-09-06 product and code review](plans/2026-09-06-code-review.md)
- [Sol/Luna implementation program with Astra review gates](plans/2026-09-06-implementation-program.md)
- [Implementation task packets](plans/2026-09-06-implementation-packets.md)
- [Agent assignments and review contract](plans/2026-09-06-agent-review-contract.md)
- [Active unattended development ledger](plans/2026-07-20-unattended-development.md)
- [Developer MCP sandbox foundation](plans/2026-07-19-developer-mcp-sandbox-foundation.md)
- [Developer MCP executable authority vocabulary](plans/2026-07-31-developer-mcp-authority-vocabulary.md)
- [Developer MCP modern protocol contract](plans/2026-07-31-developer-mcp-modern-protocol.md)
- [Clerk authentication-provider design](superpowers/specs/2026-07-20-clerk-auth-provider-design.md)
- [Clerk browser and administration implementation plan](superpowers/plans/2026-07-20-clerk-browser-admin-provider.md)
- [Safe unattended pipeline implementation](plans/2026-07-21-unattended-pipeline.md)
- [Machine-readable unattended backlog](plans/unattended-backlog.json)

Completed plans remain here as implementation evidence and may use future tense
from the time they were written. Current capability belongs in the platform
guide, and the next step belongs in the handoff; do not infer either from an old
plan.

## Operations

- [Local developer workspace](tooling/local-workspace.md)

- [Local and hosted deployment runbooks](runbooks/)
- [Reproducible containers, Vercel REST and optional Kamal](runbooks/deploy.md)
- [Hosted preview and per-deployment identity selection](runbooks/deploy-preview.md)
- [Multiple tenant identity anchor recovery](runbooks/tenant-anchor-recovery.md)
- [Optional Vercel operator MCP](runbooks/vercel-operator-mcp.md)
- [Browser end-to-end tests](tooling/e2e.md)
- [Persistent synthetic UAT](tooling/uat.md)
- [Repository knowledge graph](tooling/knowledge-graph.md)
- [Archify diagrams](tooling/archify.md)
- [Safe unattended development](tooling/unattended-development.md)
- [shadcn/ui CLI support](tooling/shadcn.md)

## Security

- [Audit checkpoint operations and key rotation](security/audit-checkpoints.md)

- [Developer MCP threat model](security/developer-mcp-threat-model.md)

## Licensing and participation

- [Repository licensing map](../LICENSING.md)
- [Commercial licensing boundary](../COMMERCIAL-LICENSE.md)
- [Trademark policy](../TRADEMARKS.md)
- [Contribution policy](../CONTRIBUTING.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [Technical licence and provenance review](legal/2026-07-20-technical-licence-provenance-review.md)
- [Preliminary dependency licence inventory](legal/2026-07-20-dependency-licence-inventory.md)

The repository is local-first. Runbooks do not authorize cloud mutations;
`RTK.md` and explicit owner approval govern provider operations.
