# Usage export

`@opentenant/usage-export` exports immutable exact-usage evidence through a
`UsageExportSink`. The PostgreSQL ledger remains the source of truth. Export
does not modify ledger rows, define prices, create entitlements or invoices,
or enable billing. `OWNER-BILLING-01` remains required.

## Worker wiring point

The durable Graphile worker schedules `runUsageExport` every minute after applying forward migration
`0065_usage_export.sql`. Migration 0066 remains reserved and unused. The worker retries failed drains up to five times. The function takes an existing control-plane
`pg.Pool` and an explicitly constructed sink. The platform config now recognizes
`USAGE_EXPORT_SINK`, `USAGE_EXPORT_DIRECTORY`, `OPENMETER_INGEST_URL` and
`OPENMETER_API_KEY`; the default is a local file sink under `~/.local/share/opentenant/usage-export`.
Set `USAGE_EXPORT_DIRECTORY` to choose another private local directory.
OpenMeter is selected only when both its endpoint and API key are configured,
or explicitly with `USAGE_EXPORT_SINK=openmeter` and both values present.
`USAGE_EXPORT_SINK=file` keeps local delivery even with OpenMeter credentials.
Sink IDs include a destination hash, so changing destinations does not reuse
another destination's receipts.

```ts
import { FileUsageExportSink, runUsageExport } from "@opentenant/usage-export";

await runUsageExport({
  pool: controlPlanePool(),
  sink: new FileUsageExportSink("development-files-v1", exportDirectory),
  batchSize: 100,
  maxBatches: 10,
});
```

Schedule bounded drains and record the returned `{ exported, batches }`. Retry
failed jobs on the worker's normal retry schedule. Default batch size is 100,
maximum 1000. The default run stops after 10 batches. Delivery retries at most
four times with exponential waits starting at 250 ms and capped at 30 seconds.
HTTP requests time out after 10 seconds. Only network failures, 429 and server
errors retry within a drain. Authentication and validation failures stop it.
Persist no upstream response bodies in operational logs.

## Durable cursor and replay

Migration 0065 adds `usage_export_cursors` and `usage_export_receipts`, plus a
read index. A cursor row belongs to a stable sink ID and records the last
acknowledged event, total exported count and update time. A receipt per
sink/event is the authoritative acknowledgement cursor. The job reads only
the five export fields from ledger entries without receipts, ordered by
recording time and ID. It holds the sink cursor's row lock through delivery
and acknowledgement so concurrent workers cannot advance the same sink twice.

A timestamp-only cursor can permanently miss a writer that commits an older
recording timestamp after the export snapshot. The receipt anti-join includes
such entries on the next run. Correction rows follow the same path as ordinary
entries. Their event IDs and signed quantities remain distinct; no netting or
replacement occurs.

Receipts and cursor progress commit together only after full-batch acceptance.
If a provider accepts a batch but its response is lost, or the database commit
fails, the next attempt sends the same CloudEvent source and ledger entry ID.
Delivery is at least once. Effective idempotence depends on the sink retaining
that identity. An export receipt means ingestion acknowledgement, not downstream
aggregation or billing settlement. Retain receipts for as long as the ledger
can be exported. Do not prune them or reset sink identities during routine jobs.

Use a separate stable sink ID for each destination. Reusing an ID while changing
its endpoint or output directory would incorrectly treat the new destination
as already exported. Changing the source identity would defeat remote replay
deduplication. Review provider dedupe retention and old-event acceptance before
any hosted enablement.

## OpenMeter adapter

`OpenMeterUsageExportSink` is a small independently written HTTP client for the
published [OpenMeter v1 ingest API at tag v1.0.0-beta.202](https://github.com/openmeterio/openmeter/blob/v1.0.0-beta.202/api/openapi.yaml).
It sends `POST` to the configured full endpoint with
`application/cloudevents-batch+json` and requires HTTP 204. This intentionally
targets that versioned compatibility API rather than assuming compatibility
with newer API versions. No SDK or vendor code was copied.

CloudEvents use:

| Field | Source |
| --- | --- |
| `id` | Ledger entry ID |
| `source` | Constant `urn:opentenant:usage-ledger` |
| `type` | Registered metric name |
| `subject` | Tenant ID |
| `time` | Occurrence timestamp |
| `data.quantity` | Exact signed safe integer |

The payload is projected at the job and sink boundary. Source references,
fingerprints, correction reasons, tenant content and credentials never enter
the payload. HTTPS is required except for loopback development HTTP. Credentials
are explicit; redirects are refused. No endpoint or account is hard-coded.

```ts
const sink = new OpenMeterUsageExportSink({
  id: "local-openmeter-v1",
  endpoint: "http://127.0.0.1:8888/api/v1/events",
});
await runUsageExport({ pool: controlPlanePool(), sink });
```

Tests use mock loopback HTTP servers, including ambiguous acceptance and
deduplication. They do not establish a real OpenMeter deployment's dedupe,
retention or aggregation behavior. No OpenMeter cloud API was contacted.

## Development file sink

`FileUsageExportSink` publishes one JSON file per event ID with private file
permissions. It fsyncs a temporary file, hard-links it into place atomically,
and syncs the directory before acknowledgement. Identical replays succeed;
conflicting content under the same ID fails. A crash can leave a hidden temp
file but cannot expose a partial final JSON file. Use a local filesystem that
supports hard links and directory fsync, in a private directory outside public
web roots. The sink is for development and does not provide billing semantics.

The integration suite uses a disposable `pgvector/pgvector:0.8.2-pg17-bookworm`
database, validates migration application, preserves append-only ledger guards,
and exercises retry, exhaustion, correction export, replay, restart, concurrent
workers and late commits. Set `USAGE_EXPORT_DATABASE_URL` to a loopback database
whose name begins with `opentenant_it_`; the suite recreates its public schema.
