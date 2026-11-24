# Transactional support email

`@opentenant/notifications` defines a provider-neutral `EmailTransport` port,
a Nodemailer SMTP adapter and a support template rendered by React Email.
SMTP accepts typed constructor options, including host, port, sender, TLS and
optional authentication. Credentials stay in the server composition root.
No SaaS provider adapter is included.

Nodemailer is an optional installation dependency because a deployment can use
another `EmailTransport`. A normal install includes it; an offline install may
omit it if it is not cached. SMTP then fails closed with a safe error. Verify
it is present before enabling SMTP delivery. Never treat a synthetic adapter
as evidence of SMTP delivery.

Use `createSupportDeliveryService(store, { email: smtpOptions, directory,
inApp })` from `@opentenant/support` to compose Support Depth with real email.
A custom provider-neutral email port can also be injected. The directory must
resolve opaque destination references within the given tenant. A result for a
different tenant is rejected. In-app delivery needs its own transport.
`SyntheticDeliveryTransport` stays available for tests.

Templates contain a ticket number and event only, with both HTML and plain
text. React escapes untrusted ticket metadata. Ticket bodies, internal notes
and recipient addresses stay out of delivery evidence. SMTP failures become
safe transient/permanent/destination classes. The support service owns
idempotency and retries; a stable Message-ID helps correlation but SMTP itself
does not promise exactly-once delivery.

Reconciled 2026-11-17: the original in-memory Support Depth helper remains a
library entry point, while ticket delivery now has `PgSupportDeliveryStore`,
`createSupportEmailDeliveryTask` and platform worker dispatch. The
[V1 receipt](../../tooling/ci/db-sequence-inventory.md) executes eight delivery
cases with zero skips. The [wave-5 browser receipt](../adopters/wave5-wiring-verification.md)
includes ticket email restart/retry behavior. These local proofs do not establish
production deliverability. Marketing impact: none.

## Mailpit for local development

Compose defines MIT-licensed Mailpit at `axllent/mailpit:v1.27.8`, pinned to
`sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707`, bound only
to loopback, with SMTP on **11026** and HTTP/UI on **18026**. These avoid the
usual 1025/8025 ports and the repository's database ports. It captures mail
locally and configures no relay. Do not use genuine recipient or tenant data.

```sh
docker compose up -d --wait mailpit
pnpm --filter @opentenant/notifications test:mailpit
docker compose stop mailpit
```

Use SMTP options `{ host: '127.0.0.1', port: 11026, secure: false,
from: 'support@example.test' }`. Outside loopback, the adapter requires direct
TLS or STARTTLS with certificate verification. It disables Nodemailer logging,
URL/file reads and pooled background connections.

## Docker and CI proofs

```sh
pnpm smtp:proof
```

The command starts the same digest-pinned Mailpit version on random loopback
SMTP/HTTP ports, requires `MAILPIT_REQUIRED=1`, runs the notifications transport
test and three application-path tests, and removes its container on exit.
It pre-pulls pinned pgvector 0.8.2 / PostgreSQL 17 and uses `pnpm db:ephemeral`
for the identity database. No running local stack or genuine mail account is
needed. Both JSON reports must have exact counts, zero failures and zero skips.
An independent controller-death janitor backs container cleanup.

The dedicated `smtp-proof` CI job uses a Mailpit service container with that same
digest and `MAILPIT_REQUIRED=1`. The application suite runs against a fresh
canonical-migration database. GitHub Actions is billing-blocked; no hosted CI
receipt for these waves is available.

On 2026-11-14 the local command passed **4 tests, 0 failures, 0 skips** in
**18.612 seconds**, including database startup and cleanup:

- The notifications package sends SMTP and reads captured mail through HTTP.
- Support's real `createSupportDeliveryService` resolves a tenant-bound opaque
  destination, delivers through `SmtpEmailTransport`, and records the attempt.
  Mailpit confirms recipient, subject, rendered React Email HTML and plain text.
- Better Auth signup sends verification through `betterAuthMailHooks` and the
  same notifications transport. The captured body URL verifies the real user.
- The real Better Auth identity gateway persists and emails an invitation.
  Mailpit confirms recipient, subject and the exact persisted invitation URL.

Identity emails deliberately have plain-text bodies and empty HTML. Tests check
that behavior explicitly. SMTP CRLF and React's inline HTML comments are
normalized when comparing rendered content. Raw captured headers contain no
identity secret, account password, SMTP password, verification/invitation token,
authorization or cookie headers. Mailpit accepts synthetic SMTP authentication
for these tests only, with no relay configured. This proves local transport and
composition at that revision. The later local durable-delivery proofs are linked
above; production deliverability remains unproved.

The notifications-only test still supports a manually started Compose service.
`MAILPIT_HTTP_URL` and `MAILPIT_SMTP_PORT` select alternate local bindings;
non-loopback HTTP URLs are rejected. Without `MAILPIT_REQUIRED=1`, an unavailable
optional local service produces a skip, which is not SMTP proof.
See the [verification record](../reviews/2026-11-14-real-sandbox-smtp-proofs.md)
for failed development assertions and the complete command inventory.
