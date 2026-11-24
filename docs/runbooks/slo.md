# Platform service objectives

These are proposed operating targets for a deployment, not production evidence.
Use a rolling 30-day window. Do not enable an external collector, DSN or probe
service until its deployment and data-retention scope is approved.

| Objective | Indicator | Target |
| --- | --- | --- |
| Availability | Successful external `GET /api/ready` probes divided by all scheduled probes. Timeouts, TLS errors, connection errors and HTTP 503 count as failures. | 99.9% |
| Readiness | HTTP 200 responses from an internal `GET /api/ready` probe divided by scheduled internal probes for every serving instance. Missing samples count as failures. | 99.9% |
| Ready latency | p95 elapsed request duration for `GET /api/ready` root spans, including failed requests. | Below 500 ms |
| Mutation latency | p95 elapsed root-span duration for admitted platform API mutations, excluding streaming module responses. Report 429 separately and count 5xx failures in availability. | Below 1 s |

Probe each instance internally every 15 seconds and the public endpoint every
30 seconds. Readiness performs a bounded control-plane query and validates
runtime configuration. It returns only a generic ready or unavailable result.
`/api/health` is liveness and cannot establish these objectives. Readiness does
not prove a tenant database, identity provider or module upstream is healthy;
use synthetic, content-free journey checks for those dependencies.

## Trace and error configuration

All adapters are disabled by default. `OPENTENANT_OTLP_ENDPOINT` opts into OTLP
HTTP export and specifies the complete endpoint, such as a loopback collector's
`http://127.0.0.1:4318/v1/traces`. The app uses `@vercel/otel` when `VERCEL=1`
and the Node OpenTelemetry SDK elsewhere. It works without either a collector
or a DSN. Configure collector authentication at the local collector or ingress;
credentials in the endpoint URL are rejected.

`SENTRY_DSN` enables server error capture against any Sentry-protocol endpoint,
including self-hosted GlitchTip. Events contain a fixed failure message and
an event ID/time only. SDK 11 data-collection categories are explicitly disabled and `beforeSendLog`
drops SDK logs; the legacy `sendDefaultPii` flag is also false.
Automatic integrations, breadcrumbs, PII, SDK logs and
Sentry tracing are disabled. The original exception is not sent. Client error
boundaries show generic messages; this release captures server request errors.

Exported spans keep trace/span IDs, timings, bounded HTTP status codes, fixed
operation names, and the static `/api/ready`, `/api/health`, or `/api/telemetry`
route when available. They drop query text, connection strings, URL query
parameters, headers, events, exception strings, resource metadata, links and
user/tenant identifiers. Structured pino logs use a fixed event vocabulary,
numeric timing/status fields and the active trace ID. No arbitrary message or
client telemetry value is logged.

`identity.validate` and `module.proxy` spans are wired. pg instrumentation covers
queries, including BEGIN/COMMIT/ROLLBACK, on both tenant and control-plane pools.
The `traceSpan("tenant.resolve", fn)` helper is exported for the tenant-resolution
owner to wire at merge. Do not claim tenant-resolution span coverage until then.

At the collector, derive request counts and durations from root spans named
`platform.request`; filter readiness by `http.route=/api/ready` and keep one
sample per root span. Enable all request sampling for SLO computation. Sampling
must not depend on status or latency. Keep probe counts independently so an
export failure cannot masquerade as service availability. Select mutation spans using the bounded `http.request.method` attribute and
server-span kind. Include only POST, PUT, PATCH and DELETE. Classify module
proxy spans separately using `module.proxy`.

## Example alerts

Use generic rule names such as `PlatformAvailabilityBudgetBurn`,
`PlatformReadinessFailure`, `PlatformReadyLatencyP95` and
`PlatformTelemetryMissing`. For a 99.9% objective, page when the error-budget
burn rate exceeds 14.4 over both 1 hour and 5 minutes, or 6 over both 6 hours
and 30 minutes. Alert on two consecutive failed readiness probes per instance.
Alert on ready p95 above 500 ms for 10 minutes with at least 20 observations,
and on a missing telemetry series for 5 minutes. Tune minimum sample counts
for actual traffic before enabling paging.

An operator first checks `/api/ready`, then control-plane connection usage and
migration state, then the content-free trace/log correlation ID. Never paste
request bodies, cookies, DSNs, database URLs or tenant content into alerts.

## Rate-limit operations

Apply migration `0050_request_rate_limits` before starting the new route gates.
Limits are fixed-window requests per 60 seconds: settings/support 60, members
and brand proposals 20, identity portals 10, tenant creation 5, passcode 10,
and module access 30. Installation-wide support policy/exit controls aggregate
under a server-owned installation scope and the verified operator.
Passcode verification and module proxy POSTs also allow only five attempts per
IP, tenant and route class per minute. Key material is hashed before storage.

Set `OPENTENANT_TRUSTED_IP_HEADER` only behind an ingress that strips and
replaces that header and prevents direct app access. Never trust client-sent
`X-Forwarded-For`. Without a configured trusted header, mutations share the
strict `unattributed` bucket for their tenant/class. Malformed or multi-IP
header values also share that bucket. A store failure returns 503; exhaustion
returns 429 with a rounded-up `Retry-After` in seconds. There is no in-memory
fallback. One separate connection per process accesses the same control-plane
database without consuming the app pool's five connections. Include that extra
connection when sizing a multi-instance deployment. The dependency removes
rows expired for more than an hour every five minutes while the process lives;
operators can schedule equivalent cleanup for deployments that suspend.

Tenant creation is not wired in this branch because the lifecycle agent owns
`app/api/admin/tenants/**`. That owner must call `enforceRateLimit` after its
installation-owner gate, using a server-owned installation scope and the
verified user, with route class `tenant-creation`.
