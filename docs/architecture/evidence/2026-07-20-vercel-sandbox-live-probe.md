# Vercel Sandbox live probe

Date: 2026-07-20

Owner authorization: one isolated Vercel test using credentials in the ignored
local `.env`. No secret, account identifier, project identifier, deployment
URL, sandbox identifier, or provider response body is recorded here.

## Scope

- REST API only; the repository-prohibited Vercel CLI was not used.
- One empty test project at a time, with no Git link, deployment, domain,
  environment variables, integration, or production setting.
- One Node.js 22 sandbox, 1 vCPU/2 GB, deny-all egress requested, no exposed
  ports, no injected secrets, and a 60-second hard timeout. The API accepted
  the network configuration; outbound enforcement was not actively challenged.
- One synthetic command that prints a fixed non-secret marker.
- Stop and project deletion in cleanup, including intermediate failures.

## Account and project discovery

| Check | Result |
|---|---|
| Access token authentication | HTTP 200; identity present |
| Configured team scope | HTTP 200; accessible |
| Visible projects | 2 |
| Projects linked to the configured OpenTenant repository | 0 |

The discovery response was reduced to status, count, and boolean fields before
logging. Provider names, IDs, URLs, and emails were discarded.
The adjacent
[`2026-07-20-vercel-sandbox-live-probe.json`](2026-07-20-vercel-sandbox-live-probe.json)
contains the complete retained, sanitized result record.

## Lifecycle evidence

The account-level create attempt without a project returned HTTP 400 and
created no resource. The exact ephemeral-project probe then produced:

| Operation | Result |
|---|---|
| Create empty test project | HTTP 200 |
| Create deny-all Node 22 sandbox | HTTP 200 |
| Execute synthetic structured command | HTTP 200; expected marker observed |
| Stop non-persistent sandbox session | HTTP 200 |
| Delete already-stopped non-persistent named sandbox | HTTP 400 |
| Delete containing test project | HTTP 204 |
| Residual test projects after cleanup | 0 |

A follow-up empty project was created to test persistent named-sandbox
deletion. Persistent sandbox creation returned HTTP 400; the empty project was
deleted with HTTP 204. Error bodies were deliberately not retained because
provider responses are treated as hostile and may contain identifiers.

## Conclusion

The selected account can authenticate, create an isolated Vercel Sandbox whose
accepted configuration requested deny-all egress, run a structured Node 22
command, and stop it. Project cleanup is verified. The named deletion request
after non-persistent stop returned HTTP 400. Its cause is undetermined because
the provider response body was intentionally not retained. Separate named
deletion, residual-sandbox listing, and runtime egress enforcement are
**not verified**.

This probe does not approve production use. Region selection/observation,
pricing, retention, snapshot deletion, authenticated previews, artifact reads,
credential injection, concurrency, and the OpenTenant SDK wrapper remain open.
No deployment or persistent hosted OpenTenant project was created.
