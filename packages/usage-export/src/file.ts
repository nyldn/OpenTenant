import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { UsageExportError, usageCloudEvent, type UsageCloudEvent, type UsageExportSink } from "./contracts";

/** One atomically published JSON file per ledger ID. Local development only. */
export class FileUsageExportSink implements UsageExportSink {
  constructor(readonly id: string, private readonly directory: string) {}
  async emit(events: readonly UsageCloudEvent[]): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const input of events) {
      const event = usageCloudEvent({ eventId: input.id, tenantId: input.subject, metricId: input.type, quantity: input.data.quantity, occurredAt: input.time });
      const body = `${JSON.stringify(event)}\n`;
      const target = join(this.directory, `${event.id}.json`);
      const temp = join(this.directory, `.${randomUUID()}.tmp`);
      try {
        const file = await open(temp, "wx", 0o600);
        try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
        try { await link(temp, target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(target, "utf8") !== body) throw new UsageExportError();
        }
        const directory = await open(this.directory, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } catch { throw new UsageExportError(); }
      finally { await unlink(temp).catch(() => undefined); }
    }
  }
}
