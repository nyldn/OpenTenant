import { UsageExportError, usageCloudEvent, type UsageCloudEvent, type UsageExportSink } from "./contracts";

export interface OpenMeterOptions {
  readonly id: string;
  /** Full ingest endpoint. Pinned to OpenMeter v1 CloudEvents batch API. */
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class OpenMeterUsageExportSink implements UsageExportSink {
  readonly id: string;
  private readonly endpoint: URL;
  constructor(private readonly options: OpenMeterOptions) {
    this.id = options.id;
    this.endpoint = new URL(options.endpoint);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(this.endpoint.hostname);
    if ((this.endpoint.protocol !== "https:" && !(local && this.endpoint.protocol === "http:")) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash
      || (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000))) throw new UsageExportError();
  }
  async emit(events: readonly UsageCloudEvent[]): Promise<void> {
    // Project again at the external boundary even for callers bypassing the job.
    const payload = events.map((event) => usageCloudEvent({ eventId: event.id, tenantId: event.subject, metricId: event.type, quantity: event.data.quantity, occurredAt: event.time }));
    if (!payload.length || payload.length > 1000) throw new UsageExportError();
    try {
      const response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: { "content-type": "application/cloudevents-batch+json", ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        body: JSON.stringify(payload),
      });
      await response.body?.cancel();
      if (response.status !== 204) throw new UsageExportError(response.status === 429 || response.status >= 500);
    } catch (error) {
      if (error instanceof UsageExportError) throw error;
      throw new UsageExportError(true);
    }
  }
}
