# Durable Support email

Apply tenant-support/0007_durable_email before enabling the worker. Numbers
0008 and control-plane 0086–0087 are unused. No control-plane delivery state is
needed. The existing ticket outbox remains the helpdesk projection's queue.
Its insert trigger also writes the email queue in the ticket/reply transaction.
There is no historical backfill. Internal notes never enqueue email.

Only the requester's enabled tenant-local email preference is selected. Queue
rows store the subject and opaque directory reference, never addresses or
content. The worker rechecks the current preference before sending. The
injected directory must resolve active tenant membership, return the same
tenant ID, and never accept a recipient supplied by an HTTP request. Directory
and SMTP errors become one of three safe classes. Ticket bodies stay in the
portal; the existing Support email template renders metadata only.

Pending email becomes sending when claimed with SKIP LOCKED and a random lease
token. Each attempt has a five-minute lease. A receipt requires that token and
an unexpired lease, preventing an old worker from overwriting a newer claim.
Transient failures become retry with delays of 30, 60, 120 and 240 seconds.
Five attempts, a permanent failure, or an unavailable destination becomes
failed. Expired leases are reclaimable after restart; expiry on the fifth
attempt becomes an audited failure. Claims are one at a time so a batch does
not wait in memory while its leases expire. The existing SMTP adapter's bounded
connection, greeting and socket timeouts fit inside the lease. Custom transports
must also finish within that lease.

Successful receipts become delivered and cannot be reopened. Staff with
support.ticket.manage can queue a failed email again in the ticket UI. Its
state change and full audit actor, including managed support attribution,
commit in one statement. Concurrent manual retries produce one audit event.
Manual retry resets the automatic attempt budget but preserves total attempts
and message identity. The shared TicketForm supplies pending state, disabled
controls and F1 FormStatus receipts, retaining S3 focus and responsive patterns.

SMTP is at-least-once. If SMTP accepted a message but its acknowledgement or the
committed delivery receipt was lost, recovery may send it again. Every retry,
including manual retry, uses the original idempotency key. The existing SMTP
transport hashes that key into a stable Message-ID. Receivers may deduplicate
it, but SMTP offers no exactly-once guarantee. Normal successful delivery is
not sent again; stale leases cannot record a receipt or reset delivered state.

## Integrator wiring

- SUPPORT_MODULE registers 0007_durable_email.sql and the RLS inventory covers
  both tables. The integrator retains the tooling catalog and checksum baseline.
- The module's existing helpdesk service now exports createEmailDeliveryTask.
  It is createSupportEmailDeliveryTask from delivery-worker.ts. Add a barrel
  export only if direct package access is needed; no database barrel is needed.
- Compose the factory with withTenantDb, a tenant-bound SupportEmailDirectory,
  and the existing configured SMTP transport or its SmtpOptions. Directory
  resolution must check tenant membership and return no cross-tenant records.
  Do not create a separate SMTP client implementation or use the tenant DB as
  a control-plane identity directory.
- Add worker dispatch and a periodic pass for active tenants with the module
  enabled. Invoke the returned task with tenantId and an optional bounded batch
  limit, default 25. Repeat periodically even when no new outbox event arrives,
  so backoff and expired leases recover. Existing Graphile tenant queues can be
  reused. Keep SMTP outside tenant transactions.
- Supply preference management through the existing tenant-local
  support.delivery_preferences table with explicit user opt-in. Disabled or
  changed preferences fail closed before SMTP. HTTP retry accepts only delivery
  and ticket IDs; it cannot override the recipient.
- Host ports and server-config.ts were not changed. The factory accepts ports
  directly, so the integrator can expose a neutral configured email/directory
  service if needed. No new environment variables are read by module runtime.

The browser proof verifies that canonical provisioning applied migration 0007
to Alpha's local fixture, then drives the real ticket and
reply HTTP routes and retry form. It invokes fresh worker task instances and
reads the shared Mailpit fixture. Alpha keeps these tickets out of the shared
workspace queue used by support.spec.ts and support-accessibility.spec.ts.

## Local verification

All test launchers ran in foreground Forge jobs with bounded thread counts.
The final Support unit suite passed 116 cases; its ordinary run skips the eight
live database cases. Running the complete suite with
`pnpm db:ephemeral -- pnpm --filter @opentenant/support test` passed all 124
cases with zero skips, including the eight new PostgreSQL delivery proofs.
Support and E2E typecheck and lint passed.

`pnpm db:ephemeral -- node tooling/ci/rls-proof.mjs` passed 334 checks across
33 tenant tables after manifest registration. From tooling/ci,
`node --test rls-inventory.test.mjs` passed all three cases. The approved
inventory changes add only these two tables, synthetic seeds and the expected
table-count change from 31 to 33. No proof assertions or policies changed.

`pnpm db:ephemeral -- pnpm ci:db-sequence` passed after manifest registration,
including all store suites and the provisioning, identity, worker, usage-export
and isolation-fuzz proofs, with zero skipped cases. The exact broad command
`pnpm turbo typecheck lint test --concurrency=2` reached the expected new
migration checksum mismatch: 114 tasks succeeded out of 115, with only
@opentenant/migrations#test failing. A complete run with --continue=always
also finished 114/115 with the same sole failure. The integrator must update
the tooling catalog and checksum baseline; no existing migration checksum
changed.

Migration 0007 SHA256:
`42fe4cf13f74c15b491a7e8b1af1a8a391f963ab38fe984c3f82e2dd5d221f66`.

Approved edits outside the original ownership are the one-case legacy E2E
registration, the two RLS inventory entries and fixtures with the 31-to-33
count change, and the accessibility spec's authenticated GET-only beforeAll.
That hook checks a random missing ticket and the tickets API without creating
tickets or changing per-test deadlines. Each scope expansion has a separate
commit, with both RLS inventory files grouped together.

The first two browser repetitions passed the first accessibility case after
the warmup but stalled during later mutations: respectively four passes and
one failure in legacy. A third diagnostic run passed all six cases across
phases. Those runs preceded rebuilding the stream-release fix, so they do not
prove that fix. A fourth diagnostic run was cancelled to rebuild Support.
The shared form helper now cancels unused redirected HTML response bodies,
releasing streams after both successful and rejected mutations while keeping
the S3 controls and F1 feedback.

After rebuilding Support and verifying cancellation in dist/host-ui.js, the
three final browser repetitions completed as follows. Each command ran with
CI=1; the support.spec.ts filter also selects managed-support.spec.ts.

| Run | Command | Result |
| --- | --- | --- |
| 1 | `pnpm e2e support-accessibility.spec.ts support.spec.ts support-email.spec.ts` | 6 passed, 0 failed, 0 skipped |
| 2 | Same command | 5 passed, 1 failed, 0 skipped; only managed-support's banner wait failed |
| 3 | `pnpm e2e support.spec.ts support-accessibility.spec.ts managed-support.spec.ts support-email.spec.ts` | 6 passed, 0 failed, 0 skipped |

All five legacy Support/email cases passed in each final run. The repeated
mutation case took 14.5, 12.1 and 12.0 seconds. In run 2, the unrelated managed
Support POST returned 303 in 5.2 seconds and displayed Action accepted, but the
banner did not appear within its existing 15-second assertion deadline. That
case passed in runs 1 and 3. Its file and deadlines remain unchanged. No full
E2E suite, a11y scan, baseline or remap edit was used.

After browser testing, `pnpm --filter @opentenant/platform build` passed.
`node scripts/check-module-special-cases.mjs` reported 0.
`git diff --check 5ea19d9 HEAD` passed. Recorded browser listener ports closed
and their Mailpit containers were removed; Forge audit found no unmanaged
servers. Graphify's AST data was refreshed and its generated files remain
uncommitted. Its SQL parser is unavailable, so the SQL migration is verified
by the live database proofs rather than graph extraction.
