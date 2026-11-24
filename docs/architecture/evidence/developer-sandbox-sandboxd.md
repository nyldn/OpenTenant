# Developer sandbox evidence: sandboxd feasibility

Date: 2026-07-19

Status: HTTP lifecycle adapter implemented; not approved as the production
sandbox boundary

## Source reviewed

- Repository: `tastyeffectco/sandboxd`
- Revision: `83f2f73c1f8fd1d0b2a1cc6f2ca4004140b3482f`
- Licence reported by GitHub: MIT
- Contract source: `docs/openapi.yaml` at the revision above
- No sandboxd source code was copied, cloned into this repository, or vendored.
  The adapter independently implements the documented HTTP protocol.

## Useful documented capabilities

- Private sandbox creation and lifecycle start/stop/delete
- Atomic workspace file writes and bounded file reads
- Live preview state and URL discovery
- Stop-then-snapshot and fork-from-snapshot lifecycle
- Bounded supervised-process log tails
- Bearer-authenticated API support
- Agent-task checkpoints and revert operations outside the base adapter

## Gaps against the OpenTenant contract

1. The documented REST API has no bounded structured command endpoint. It
   exposes coding-agent tasks and an interactive WebSocket terminal. Neither
   safely implements `executable + args + timeout + output limit`, so the
   adapter advertises `structuredCommands: false` and fails closed.
2. `CreateSandboxRequest` does not expose per-workspace CPU, memory, duration,
   process, or egress policy. Deployment-level Docker hardening may exist, but
   it cannot be proven or varied through this API, so the adapter advertises
   `resourceLimits: false` and `networkPolicy: false`.
3. The beta documentation describes container rather than VM isolation,
   single-server operation, and authentication hardening as production gates.
4. The API does not return OpenTenant tenant/workspace attribution. The
   feasibility adapter retains normalization metadata in memory; a production
   adapter needs durable, restart-safe control-plane binding.
5. The provider does not expose deletion evidence or a server-enforced
   OpenTenant workspace expiry through the reviewed API.

## Implemented safeguards

- HTTPS is mandatory except loopback development URLs.
- Provider URLs cannot contain credentials or query parameters.
- Bearer tokens are header-only and never included in errors.
- Upstream response bodies are never copied into errors.
- IDs and paths are encoded; workspace paths pass the shared traversal policy.
- Previews must use HTTPS and may not contain URL credentials, query strings,
  or fragments.
- Restore is bound to the tenant and exact template recorded at checkpoint.
- Termination is idempotent within an adapter instance.

## Verification

The package suite uses an injected fetch implementation and verifies request
mapping, private creation, file translation, lifecycle normalization,
stop/snapshot/start ordering, fork restore, logs, artifacts, teardown,
unsupported commands, malformed responses, and credential-safe errors.

A live sandboxd test was not run because the local Docker client is installed
but its daemon is not running. No remote sandbox, credential, deployment, or
paid resource was created.

## Decision

sandboxd remains useful for local/self-hosted evaluation and as a pattern
source. It cannot pass the full OpenTenant sandbox conformance gate at the
reviewed revision. The most valuable upstream addition would be a structured
exec endpoint with explicit per-request limits and a documented network-policy
contract. Vercel Sandbox remains the next hosted-adapter boundary to evaluate.
