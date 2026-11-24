# ADR-007: Durable work execution

Status: Proposed

Date: 2026-11-13

Decision owner: Chris

Supersedes: nothing.

## Context

OpenTenant has no general way to run work outside a request. Two pieces of
existing code already need one, and each has started to build its own.

**Tenant provisioning is a hand-built workflow.**
`apps/platform/lib/provisioning.ts` drives `provisionTenant` from
`tooling/provisioning`. It keeps step checkpoints (`project_id`, `region`,
`migrated`, `stored`) in the `provisioning_jobs` table, recovers a claim after
15 minutes without a checkpoint write, and counts failed attempts. It runs
inside the installation owner's create-tenant request
(`apps/platform/app/api/admin/tenants/route.ts`). The request waits for Neon
project creation, tenant-core migration, app-role creation and encrypted
connection storage. A failure leaves the job `failed` until someone repeats the
request. Nothing retries it.

**The owner help-desk projection has no trigger.**
`runHelpdeskProjectionPass` in `apps/platform/lib/helpdesk.ts` claims committed
tenant outbox events, applies them idempotently to the control-plane queue
index and records failures. Nothing outside the tests calls it, and the
platform declares no scheduled routes. Tenant tickets therefore never reach the
owner queue in a running installation.

More callers are coming: Brain chunking and embeddings, support AI inference,
and module work that should not hold a browser request open. If each one
builds its own claim, lease, checkpoint and retry logic, the platform will
collect several queue implementations with different failure behaviour. A
common failure is a retry rule that never terminates.

The architecture already sets two rules for this work:

- background jobs use an approved service grant, never the last interactive
  user's authority (`docs/architecture/multi-tenant-operations.md`); and
- telemetry carries identifiers, enums, counts and outcomes only, never tenant
  content (`packages/observability`).

`RTK.md` adds that OpenTenant is local-first, that hosted providers are
optional adapters, and that provider SDK imports belong only in adapter
composition roots.

## Decision

### 1. One work contract in `platform-core`

`platform-core` defines a provider-neutral contract for durable work. Modules
and platform code depend on the contract only.

- **Work kinds are registered.** Each kind declares its name, payload schema,
  retry policy, attempt ceiling, timeout and per-tenant concurrency. An
  unregistered kind is rejected at enqueue time.
- **Payloads carry identifiers, never content.** A payload holds tenant,
  resource and version identifiers. A handler reads canonical state inside the
  tenant's own database context when it runs. This keeps tenant content out of
  every backend's storage, logs and dashboards.
- **Every job is tenant-bound or explicitly installation-scoped.** A
  tenant-bound job carries its `TenantId`, and the runner resolves the tenant's
  database through the existing tenant-database path. No job reaches another
  tenant's data.
- **Jobs run under a service grant.** The enqueuer records which grant the job
  runs under. The handler receives that grant and never the enqueuing user's
  session. The grant, the job kind and the outcome are audited.
- **Enqueue is idempotent.** Every enqueue carries an idempotency key. A
  repeated key returns the existing job instead of creating a second one.
- **Steps are checkpointed.** A handler is a sequence of named steps. A
  completed step's result is recorded, and a retried job resumes after its last
  completed step. Step results hold identifiers and small status values only,
  under the same no-content rule as payloads.
- **Retries terminate.** Each kind has exponential backoff and a hard attempt
  ceiling that no code path decrements. A job that exhausts its attempts moves
  to a dead-letter state the owner can inspect and redrive. A handler can
  classify an error as permanent to stop early.
- **Per-tenant concurrency is part of the contract.** A kind declares how many
  runs may execute at once for one tenant. A busy tenant cannot starve the
  others.
- **Errors are normalised before they are stored.** Job records keep a safe
  error class and code, never provider responses or stack traces with tenant
  content.

### 2. A Postgres adapter is the default

The default adapter runs on the control-plane PostgreSQL database the platform
already requires. It needs no hosted account, so local development, self-hosted
installations and tests use the same path.

The adapter uses an existing open-source Postgres job library instead of new
claim and lease SQL. `pg-boss` (MIT) is the first candidate: it claims with
`SKIP LOCKED`, supports `LISTEN/NOTIFY` delivery, cron scheduling, exponential
backoff and dead-letter queues. `graphile-worker` (MIT) is the alternative. The
pilot below decides between them. Per-tenant concurrency is enforced by
OpenTenant through the existing admission store
(`packages/platform-core/src/admission.ts`), scoped to tenant, service grant
and job kind, so it does not depend on either library's concurrency features.

Job state lives in the control plane. Tenant databases keep their transactional
outboxes. A job reads them; it does not move tenant content into the control
plane.

A Postgres adapter needs a long-running worker process. Local development
starts it with the platform. Hosted installations either run it as a separate
process or use the hosted adapter below.

### 3. Hosted backends are optional adapters

An installation on serverless hosting may configure a hosted backend instead.
Inngest is the first candidate: its SDK is Apache-2.0, its steps map onto the
checkpoint model, and it limits concurrency by key, which carries the tenant
identifier. Its self-hosted server is licensed under the SSPL, so OpenTenant
never requires it. The SDK import lives only in the adapter's composition
root, and an installation that does not configure it never loads it. Vercel's
Workflow DevKit (Apache-2.0) is assessed in the same pilot.

A hosted backend stores payloads and step results outside the installation.
The no-content rule in section 1 is what makes that acceptable. The owner must
still approve the provider, region and retention before any hosted backend is
enabled, as `RTK.md` requires for every provider.

### 4. Scheduling uses the same contract

Recurring work is a scheduled enqueue of a registered kind with a deterministic
idempotency key per period, such as kind, tenant and period start. The help-desk
projection pass becomes a scheduled kind per tenant with pending outbox events.
Platform routes do not add their own cron handlers.

### 5. Visibility without content

The owner console shows, per kind and tenant, queued, running, failed and
dead-lettered counts, the last success, and the last safe error class. These
counts may become allowlisted telemetry events. They never include payloads or
step results.

## Pilot

The pilot proves the contract on the two existing callers. Implementation
starts test-first on a feature branch.

1. **Provisioning.** Replace the hand-built checkpoints with four steps: create
   or find the Neon project, migrate tenant core, create the app role and store
   the connection, then activate the tenant. The create-tenant request enqueues
   the job and returns. The console shows provisioning progress. Retries resume
   from the last completed step. `provisioning_jobs` is migrated or retired once
   no caller reads it.
2. **Help-desk projection.** Schedule `runHelpdeskProjectionPass` for tenants
   with pending outbox events, using its existing idempotent apply and failure
   recording.

Acceptance:

- A provisioning job interrupted after any step resumes from the next step, and
  creates exactly one Neon project and one app role, in a test with a fake Neon
  provisioner.
- Two concurrent enqueues of the same tenant's provisioning produce one job.
- A job that keeps failing stops at its attempt ceiling and reaches dead-letter
  state. No test can make it retry forever.
- Per-tenant concurrency holds across tenants: one tenant at its limit does not
  delay another tenant's job.
- A ticket created in a tenant reaches the owner queue index without a manual
  call.
- Payloads, step results and stored errors contain no tenant content; a test
  rejects a payload schema that admits free text.
- The Postgres adapter passes the same contract test suite that any hosted
  adapter must pass.
- `pnpm turbo typecheck lint test`, the platform build and `git diff --check`
  pass.

The pilot report records which Postgres library was chosen and why, and whether
an Inngest or Workflow DevKit adapter should follow.

## Consequences

Good: one failure model for all background work; provisioning stops holding an
owner request open and gains automatic retry; the owner queue starts working;
new modules get retries, checkpoints and tenant fairness without writing their
own SQL; hosted backends remain a choice, not a requirement.

Costs: a worker process to run and monitor in self-hosted installations; a
dependency on a third-party job library, which needs the provenance and licence
review that `COMMERCIAL-LICENSE.md` requires; a migration of the provisioning
flow, which is security-sensitive because it creates databases and stores
encrypted credentials; and a contract test suite every adapter must keep
passing.

Deliberately not decided here: which hosted backend, if any, a production
installation uses; job retention periods; and whether remote modules may
enqueue work through the module SDK. Remote-module access needs its own
capability design.

## Open questions

1. Should provisioning progress be pushed to the console, or should the
   console refresh while the job runs? The platform has no client-side polling
   or push today.
2. How long are completed and dead-lettered job records kept, and are they part
   of the audit evidence export?
3. Does a tenant administrator see their own tenant's job health, or only the
   installation owner?
