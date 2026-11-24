# Vercel Sandbox adapter evidence

Reviewed: 2026-07-19

This is a documentation and contract evaluation only. No sandbox, deployment,
project, token, or other hosted resource was created.

## Reviewed source

- SDK repository revision: `05469433b5120428e1697c3713f64bdca588e854`
- npm package: `@vercel/sandbox` `2.7.1`
- Provider model: Firecracker microVM-backed ephemeral workspaces

The reviewed SDK supports command execution, file operations, snapshots,
network configuration, and port exposure. OpenTenant imports none of the SDK
in its provider-neutral contract. The adapter accepts an injected, narrow
client boundary so account selection and credentials remain in the future
composition root.

## Implemented mapping

- Node.js 22 runtime, duration, vCPU, and egress policy map into create input.
- Commands are structured arguments; combined output is bounded and truncated.
- Preview URLs are returned only through an injected authenticated OpenTenant
  mediator. Raw provider URLs are never exposed to the caller.
- Checkpoints stop the source sandbox before snapshot and restore by forking a
  tenant-bound workspace.
- Artifact reads, typed redacted errors, and deterministic stop are supported.

## Explicit capability gaps

- The provider surface does not supply OpenTenant's named process-log contract.
- Memory cannot be selected independently from the provider's vCPU ratio.
- Authenticated previews require the OpenTenant mediator, not the provider URL.
- Durable tenant/workspace binding and deletion evidence remain OpenTenant
  control-plane responsibilities.
- Plan eligibility, region availability, price, retention, and deletion
  behaviour require a separately approved live probe in a new test account.

Until that probe is approved, this adapter is test-only and receives no real
provider client or credentials.
