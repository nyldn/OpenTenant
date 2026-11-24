# OPS-08 local Slack delivery plan

## Scope

Implement the provider-independent incoming-webhook phase as a local contract:
an allowlisted ticket-message projection, encrypted/opaque credential boundary,
one-way queued delivery, bounded retries, safe health, and a clearly synthetic
manual test. No Slack API, webhook, OAuth, channel, action, or genuine tenant
data is used.

## Boundary design

- Ticket notifications are rebuilt from an explicit metadata allowlist. Runtime
  extra properties are discarded, user-controlled labels are escaped and
  bounded, deep links must be server-origin HTTPS URLs, and unfurls are off.
- A tenant-bound credential boundary supplies a webhook only to the transport
  operation. Messages, delivery records, results, errors, and health never
  carry the webhook.
- The adapter owns only copied notification envelopes. It has no ticket-store
  dependency or mutation callback, and idempotency is keyed to the canonical
  ticket version.
- Transient safe error classes retry to a bound. Permanent failures and an
  exhausted budget become visible dead letters; raw provider errors do not.

## Test-first sequence

1. Prove allowlist reconstruction, escaping, bounds, safe links, and no secret
   or content-bearing fields.
2. Prove tenant-bound credential resolution and non-observability.
3. Prove bounded retry, idempotency, dead-letter health, and immutable input.
4. Prove the manual test is synthetic and unmistakably labelled.
5. Implement the smallest local adapter and run focused support checks.
