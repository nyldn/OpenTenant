/** Hard ceilings are per export. Only smaller limits may be supplied by callers. */
export const TENANT_EXPORT_LIMITS = Object.freeze({
  pageRows: 4,
  maxRows: 2_000_000,
  maxRowBytes: 2 * 1024 * 1024,
  maxBytes: 2 * 1024 ** 3,
  maxArchiveBytes: 2 * 1024 ** 3,
  maxDiskBytes: 4 * 1024 ** 3,
  maxMs: 15 * 60_000,
  maxTables: 512,
  maxCatalogRows: 4096,
});
export type TenantExportLimits = { [Key in keyof typeof TENANT_EXPORT_LIMITS]: number };
export interface TenantExportOptions { signal?: AbortSignal; limits?: Partial<TenantExportLimits> }

export class TenantExportError extends Error {
  constructor(readonly code: string) { super(`Tenant export ${code}`); this.name = "TenantExportError"; }
}

export class ExportBudget {
  readonly limits: TenantExportLimits;
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  private readonly timer: ReturnType<typeof setTimeout>;
  private rows = 0;
  private bytes = 0;
  private disk = 0;
  private archive = 0;
  private tables = 0;
  constructor(options: TenantExportOptions = {}) {
    this.limits = { ...TENANT_EXPORT_LIMITS, ...options.limits };
    for (const key of Object.keys(this.limits) as (keyof TenantExportLimits)[]) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > TENANT_EXPORT_LIMITS[key]) throw new TenantExportError("invalid_limit");
    }
    this.signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal;
    this.timer = setTimeout(() => this.controller.abort(new TenantExportError("time_limit")), this.limits.maxMs);
    this.timer.unref();
  }
  check(): void { if (this.signal.aborted) throw new TenantExportError(this.controller.signal.reason instanceof TenantExportError ? this.controller.signal.reason.code : "cancelled"); }
  row(text: string): number {
    this.check();
    const bytes = Buffer.byteLength(text);
    if (bytes > this.limits.maxRowBytes) throw new TenantExportError("row_byte_limit");
    if (++this.rows > this.limits.maxRows) throw new TenantExportError("row_limit");
    return bytes;
  }
  table(): void { this.check(); if (++this.tables > this.limits.maxTables) throw new TenantExportError("table_limit"); }
  logical(size: number): void { this.check(); this.bytes += size; if (this.bytes > this.limits.maxBytes) throw new TenantExportError("byte_limit"); }
  diskBytes(size: number): void { this.check(); this.disk += size; if (this.disk > this.limits.maxDiskBytes) throw new TenantExportError("disk_limit"); }
  archiveBytes(size: number): void {
    this.archive += size;
    if (this.archive > this.limits.maxArchiveBytes) throw new TenantExportError("archive_byte_limit");
    this.diskBytes(size);
  }
  dispose(): void { clearTimeout(this.timer); }
}
