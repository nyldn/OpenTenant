import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, truncate, writeFile, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import type { PoolClient } from "pg";
import { ExportBudget } from "./tenant-export-bounds";
import { exportControlTables, exportCursor } from "./tenant-export-reader";
import { Readable } from "node:stream";
import { LocalTenantExportSink, tenantExportWebStream } from "./tenant-export-sink";
const id = "11111111-1111-4111-8111-111111111111";
const directories: string[] = [];
async function createExportTestSink() {
  const directory = await mkdtemp(join(tmpdir(), "export-unit-")); directories.push(directory);
  return { directory, sink: new LocalTenantExportSink(directory) };
}
async function* rows(count = 3, value = '{"tenant_id":"tenant_a"}') { for (let i = 0; i < count; i++) yield value; }
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true }))); });
describe("bounded tenant export", () => {
  it("fetches fixed cursor pages in order and closes on early consumer cancellation", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => { queries.push(sql); return { rows: sql.startsWith("fetch") ? [{ json: '{"n":1}' }, { json: '{"n":2}' }] : [] }; } } as unknown as PoolClient;
    const budget = new ExportBudget({ limits: { pageRows: 2 } });
    try {
      const found: string[] = [];
      for await (const row of exportCursor(client, "select 1", [], budget)) { found.push(row); if (found.length === 3) break; }
      expect(found).toEqual(['{"n":1}', '{"n":2}', '{"n":1}']);
      expect(queries.filter(sql => sql.startsWith("fetch"))).toEqual(["fetch forward 2 from tenant_export_rows", "fetch forward 2 from tenant_export_rows"]);
      expect(queries.at(-1)).toBe("close tenant_export_rows");
    } finally { budget.dispose(); }
  });
  it("rejects an oversized server row before it can be serialized", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => { queries.push(sql); return { rows: sql.startsWith("fetch") ? [{ json: null }] : [] }; } } as unknown as PoolClient;
    const budget = new ExportBudget();
    try { await expect(async () => { for await (const row of exportCursor(client, "select 1", [], budget)) void row; }).rejects.toThrow("row_byte_limit"); expect(queries.at(-1)).toBe("close tenant_export_rows"); }
    finally { budget.dispose(); }
  });
  it("bounds foreign-key traversal before expanding an oversized ownership graph", async () => {
    const foreignKeys = Array.from({ length: 40 }, (_, index) => ({ child_table: `child_${index + 1}`, parent_table: index ? `child_${index}` : "root", child_columns: ["parent_id"], parent_columns: ["id"] }));
    const client = { query: async (sql: string) => ({ rows: sql.includes("pg_constraint") ? foreignKeys : [{ table_name: "root", column_name: "tenant_id" }] }) } as unknown as PoolClient;
    const budget = new ExportBudget();
    try { await expect(exportControlTables(client, "tenant_a", async () => { throw new Error("must not begin exporting"); }, budget)).rejects.toThrow("catalog_limit"); }
    finally { budget.dispose(); }
  });
  it("streams valid private tar/gzip and consumes the entire download", async () => {
    const { sink: target, directory } = await createExportTestSink();
    await target.write(id, async append => { await append("tenant.synthetic", rows()); });
    const download = await target.read(id);
    const compressed = Buffer.from(await new Response(download.body).arrayBuffer());
    expect(compressed.length).toBe(download.byteLength);
    const tar = gunzipSync(compressed);
    expect(tar.subarray(0, 100).toString().replaceAll("\0", "")).toBe("tenant.synthetic.json");
    expect(JSON.parse(tar.subarray(512, 512 + parseInt(tar.subarray(124, 135).toString(), 8)).toString())).toHaveLength(3);
    expect((await readdir(directory)).sort()).toEqual([`${id}.json`, `${id}.tar.gz`]);
  });
  for (const [bound, limits] of [
    ["row_limit", { maxRows: 1 }], ["row_byte_limit", { maxRowBytes: 5 }],
    ["byte_limit", { maxBytes: 5 }], ["disk_limit", { maxDiskBytes: 5 }],
    ["archive_byte_limit", { maxArchiveBytes: 5 }], ["table_limit", { maxTables: 1 }],
  ] as const) it(`cleans all partial files on ${bound}`, async () => {
    const { sink: target, directory } = await createExportTestSink();
    await expect(target.write(id, async append => { await append("first", rows()); await append("second", rows()); }, { limits })).rejects.toThrow(bound);
    expect(await readdir(directory)).toEqual([]);
  });
  it("cleans a producer failure and rejects hostile archive names", async () => {
    const { sink: target, directory } = await createExportTestSink();
    await expect(target.write(id, async append => { await append("../escape", rows()); })).rejects.toThrow("invalid_entry");
    await expect(target.write(id, async append => { await append("first", rows()); throw new Error("producer failed"); })).rejects.toThrow("producer failed");
    expect(await readdir(directory)).toEqual([]);
  });
  it("cancels during serialization and cleans up", async () => {
    const { sink: target, directory } = await createExportTestSink();
    const controller = new AbortController();
    async function* cancelled() { yield '{"a":1}'; controller.abort(); yield '{"a":2}'; }
    await expect(target.write(id, async append => append("cancelled", cancelled()), { signal: controller.signal })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it("times out a stalled backpressured producer and cleans up", async () => {
    const { sink: target, directory } = await createExportTestSink();
    async function* delayed() { await new Promise(resolve => setTimeout(resolve, 30)); yield "{}"; }
    await expect(target.write(id, async append => append("slow", delayed()), { limits: { maxMs: 5 } })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it("refuses truncation before returning a download and detects equal-length corruption", async () => {
    const { sink: target, directory } = await createExportTestSink();
    await target.write(id, async append => append("first", rows()));
    const archive = join(directory, `${id}.tar.gz`);
    const content = await readFile(archive);
    await truncate(archive, content.length - 1);
    await expect(target.read(id)).rejects.toThrow("truncated");
    content[20] ^= 1; await writeFile(archive, content);
    const download = await target.read(id);
    await expect(new Response(download.body).arrayBuffer()).rejects.toThrow("corrupt");
    await target.remove(id); expect(await readdir(directory)).toEqual([]);
  });
  it("stops reading archive bytes while a web consumer is paused", async () => {
    let produced = 0;
    const input = new Readable({ highWaterMark: 64 * 1024, read() {
      produced += 64 * 1024;
      if (produced <= 64 * 1024 ** 2) this.push(Buffer.alloc(64 * 1024));
      else this.push(null);
    } });
    const body = tenantExportWebStream(input);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(produced).toBeLessThanOrEqual(3 * 64 * 1024);
    await body.cancel();
    expect(input.destroyed).toBe(true);
  });
  it("download cancellation releases the file and the download slot", async () => {
    const { sink: target } = await createExportTestSink();
    await target.write(id, async append => append("first", rows(10000)));
    for (let i = 0; i < 6; i++) {
      const controller = new AbortController();
      const download = await target.read(id, controller.signal);
      const reader = download.body.getReader();
      await reader.read(); await reader.cancel(); controller.abort();
    }
    const download = await target.read(id);
    await new Response(download.body).arrayBuffer();
  });
  it("reclaims only expired staging directories after a killed worker", async () => {
    const { sink: target, directory } = await createExportTestSink();
    const stale = join(directory, `.export-${id}-stale`);
    const active = join(directory, `.export-${id}-active`);
    const unrelated = join(directory, "keep-me");
    await Promise.all([mkdir(stale), mkdir(active), mkdir(unrelated)]);
    await writeFile(join(stale, "partial.json"), "[");
    await utimes(stale, new Date(0), new Date(0));
    await target.cleanup();
    expect((await readdir(directory)).sort()).toEqual([`.export-${id}-active`, "keep-me"]);
  });

  it("reclaims orphaned published output while preserving recent archives", async () => {
    const { sink: target, directory } = await createExportTestSink();
    await target.write(id, async append => append("first", rows()));
    await target.cleanup();
    expect((await readdir(directory)).sort()).toEqual([`${id}.json`, `${id}.tar.gz`]);
    await rm(join(directory, `${id}.json`));
    await utimes(join(directory, `${id}.tar.gz`), new Date(0), new Date(0));
    await target.cleanup();
    expect(await readdir(directory)).toEqual([]);
    await target.write(id, async append => append("first", rows()));
    await utimes(join(directory, `${id}.tar.gz`), new Date(0), new Date(0));
    await target.cleanup();
    expect(await readdir(directory)).toEqual([]);
  });

});
