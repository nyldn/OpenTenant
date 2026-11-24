import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, open, opendir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { PassThrough, Readable, Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { processSingleton } from "@opentenant/platform-core/runtime-globals";
import { tenantWorkerConfig } from "./tenant-worker-config";
import { ExportBudget, TENANT_EXPORT_LIMITS, TenantExportError, type TenantExportOptions } from "./tenant-export-bounds";
import type { ExportSource } from "./tenant-export-reader";

export interface TenantExportDownload { body: ReadableStream<Uint8Array>; byteLength: number }
export interface TenantExportSink {
  write(id: string, source: ExportSource, options?: TenantExportOptions): Promise<void>;
  read(id: string, signal?: AbortSignal): Promise<TenantExportDownload>;
  remove(id: string): Promise<void>;
  cleanup?(): Promise<void>;
}
export function archiveId(id: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new TenantExportError("invalid_id");
  return id;
}
const slots = () => processSingleton(Symbol.for("opentenant.tenant-export-slots"), () => ({ writers: 0, readers: 0 }));

/** Minimal POSIX ustar regular-file header. Names and sizes are host-generated. */
function tarHeader(name: string, size: number): Buffer {
  if (!/^[a-zA-Z0-9_.-]{1,95}$/.test(name) || !Number.isSafeInteger(size) || size < 0 || size > TENANT_EXPORT_LIMITS.maxBytes) throw new TenantExportError("invalid_entry");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "ascii");
  const octal = (value: number, offset: number, length: number) => header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
  octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257, 6); header.write("00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}
async function writeChunk(stream: Writable, chunk: Uint8Array, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!stream.write(chunk)) await once(stream, "drain", { signal });
}
async function* jsonArray(rows: AsyncIterable<string>, budget: ExportBudget): AsyncGenerator<Buffer> {
  yield Buffer.from("[");
  let first = true;
  for await (const row of rows) {
    const bytes = budget.row(row);
    const chunk = Buffer.allocUnsafe(bytes + (first ? 0 : 1));
    if (!first) chunk[0] = 44;
    chunk.write(row, first ? 0 : 1);
    yield chunk;
    first = false;
  }
  yield Buffer.from("]");
}

interface ArchiveWriter {
  temporary: string; raw: PassThrough; budget: ExportBudget;
  disk: (size: number) => void; names: Set<string>;
}
async function appendTable(writer: ArchiveWriter, name: string, rows: AsyncIterable<string>): Promise<void> {
  const { temporary, raw, budget, disk, names } = writer;
  budget.table();
  const filename = `${name}.json`;
  tarHeader(filename, 0);
  if (names.has(filename)) throw new TenantExportError("duplicate_entry");
  names.add(filename);
  const spool = join(temporary, "table.json");
  let size = 0;
  const count = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try { budget.logical(chunk.length); disk(chunk.length); size += chunk.length; callback(null, chunk); }
    catch (error) { callback(error as Error); }
  } });
  await pipeline(Readable.from(jsonArray(rows, budget), { objectMode: false }), count, createWriteStream(spool, { flags: "wx", mode: 0o600 }), { signal: budget.signal });
  await writeChunk(raw, tarHeader(filename, size), budget.signal);
  for await (const chunk of createReadStream(spool, { highWaterMark: 64 * 1024, signal: budget.signal })) await writeChunk(raw, chunk, budget.signal);
  await writeChunk(raw, Buffer.alloc((512 - size % 512) % 512), budget.signal);
  await rm(spool); disk(-size);
}

async function writeArchive(directory: string, id: string, source: ExportSource, budget: ExportBudget): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const space = await statfs(directory);
  const available = Number(space.bavail) * Number(space.bsize);
  const temporary = await mkdtemp(join(directory, `.export-${id}-`));
  const archive = join(temporary, "archive.tar.gz");
  const raw = new PassThrough({ highWaterMark: 64 * 1024 });
  const hash = createHash("sha256");
  let archiveBytes = 0;
  let diskBytes = 0;
  let published = false;
  const disk = (size: number) => {
    diskBytes += size; budget.diskBytes(size);
    if (diskBytes > available - 64 * 1024 ** 2) throw new TenantExportError("disk_space");
  };
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try { budget.archiveBytes(chunk.length); diskBytes += chunk.length; if (diskBytes > available - 64 * 1024 ** 2) throw new TenantExportError("disk_space"); archiveBytes += chunk.length; hash.update(chunk); callback(null, chunk); }
    catch (error) { callback(error as Error); }
  } });
  // Attach rejection handling immediately: a disk/compressor failure aborts an
  // upstream cursor or a blocked write even before the producer next awaits it.
  let outputError: unknown;
  const output = pipeline(raw, createGzip(), meter, createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal: budget.signal }).catch(error => {
    outputError = error; budget.controller.abort(error);
  });
  try {
    const names = new Set<string>();
    const writer = { temporary, raw, budget, disk, names };
    await source((name, rows) => appendTable(writer, name, rows), budget);
    budget.check();
    raw.end(Buffer.alloc(1024));
    await output;
    if (outputError) throw outputError;
    budget.check();
    const receipt = { byteLength: archiveBytes, sha256: hash.digest("hex") };
    const receiptJson = JSON.stringify(receipt);
    disk(Buffer.byteLength(receiptJson));
    await writeFile(join(temporary, "receipt.json"), receiptJson, { flag: "wx", mode: 0o600 });
    await rename(archive, join(directory, `${id}.tar.gz`)); published = true;
    await rename(join(temporary, "receipt.json"), join(directory, `${id}.json`));
  } catch (error) {
    const failure = outputError ?? error;
    budget.controller.abort(error); raw.destroy(); await output;
    if (published) await Promise.all([rm(join(directory, `${id}.tar.gz`), { force: true }), rm(join(directory, `${id}.json`), { force: true })]);
    throw failure;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** Count bytes, rather than chunks, across the Node/web stream boundary. */
export function tenantExportWebStream(input: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(input, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
}

async function openArchiveDownload(directory: string, id: string, signal?: AbortSignal): Promise<TenantExportDownload> {
  // Receipts are tiny trusted local metadata, never the archive itself.
  const receiptPath = join(directory, `${id}.json`);
  if ((await stat(receiptPath)).size > 256) throw new TenantExportError("invalid_receipt");
  const receiptFile = await open(receiptPath, "r");
  let receipt: { byteLength: number; sha256: string };
  try { receipt = JSON.parse(await receiptFile.readFile("utf8")); } finally { await receiptFile.close(); }
  if (!Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 1 || receipt.byteLength > TENANT_EXPORT_LIMITS.maxArchiveBytes || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new TenantExportError("invalid_receipt");
  const file = await open(join(directory, `${id}.tar.gz`), "r");
  try { if ((await file.stat()).size !== receipt.byteLength) throw new TenantExportError("truncated"); }
  catch (error) { await file.close(); throw error; }
  const budget = new ExportBudget({ signal, limits: { maxMs: 5 * 60_000 } });
  if (budget.signal.aborted) { budget.dispose(); await file.close(); throw new TenantExportError("cancelled"); }
  const input = file.createReadStream({ highWaterMark: 64 * 1024, signal: budget.signal });
  const hash = createHash("sha256");
  let read = 0;
  let released = false;
  const release = () => { if (!released) { released = true; budget.dispose(); slots().readers--; } };
  input.once("close", release);
  async function* chunks() {
    try {
      for await (const chunk of input) {
        budget.check(); read += chunk.length;
        if (read > receipt.byteLength) throw new TenantExportError("corrupt");
        hash.update(chunk); yield chunk;
      }
      if (read !== receipt.byteLength || hash.digest("hex") !== receipt.sha256) throw new TenantExportError("corrupt");
    } finally { input.destroy(); release(); }
  }
  const body = tenantExportWebStream(Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 }));
  return { body, byteLength: receipt.byteLength };
}

async function cleanupStaging(directory: string): Promise<void> {
  let entries;
  try { entries = await opendir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  let checked = 0;
  const grace = TENANT_EXPORT_LIMITS.maxMs + 60_000;
  for await (const entry of entries) {
    if (++checked > 10000) break;
    const staging = /^\.export-[a-f0-9-]{36}-[a-zA-Z0-9]+$/.test(entry.name) && entry.isDirectory();
    const final = /^([a-f0-9-]{36})\.tar\.gz$/.exec(entry.name);
    if (!staging && (!final || !entry.isFile())) continue;
    const path = join(directory, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info || Date.now() - info.mtimeMs <= grace) continue;
    if (staging) { await rm(path, { recursive: true, force: true }); continue; }
    const receipt = join(directory, `${final![1]}.json`);
    const receiptMissing = await stat(receipt).then(() => false, error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    });
    // Also reclaim a crash between publication and authority persistence.
    // The extra grace prevents removal before the database's 24-hour expiry.
    if (receiptMissing || Date.now() - info.mtimeMs > 24 * 60 * 60_000 + grace) {
      await Promise.all([rm(path, { force: true }), rm(receipt, { force: true })]);
    }
  }
}

/** One writer and four downloads per process bound aggregate memory and disk. */
export class LocalTenantExportSink implements TenantExportSink {
  constructor(private readonly directory = tenantWorkerConfig().exportDirectory) {}
  async write(id: string, source: ExportSource, options: TenantExportOptions = {}): Promise<void> {
    archiveId(id);
    if (slots().writers >= 1) throw new TenantExportError("busy");
    const budget = new ExportBudget(options);
    slots().writers++;
    try { await writeArchive(this.directory, id, source, budget); }
    finally { budget.dispose(); slots().writers--; }
  }
  async read(id: string, signal?: AbortSignal): Promise<TenantExportDownload> {
    archiveId(id);
    if (slots().readers >= 4) throw new TenantExportError("busy");
    slots().readers++;
    try { return await openArchiveDownload(this.directory, id, signal); }
    catch (error) { slots().readers--; throw error; }
  }
  /** Reclaim output orphaned by a killed worker, after its deadline plus grace. */
  cleanup(): Promise<void> { return cleanupStaging(this.directory); }
  async remove(id: string): Promise<void> {
    archiveId(id);
    await Promise.all([rm(join(this.directory, `${id}.tar.gz`), { force: true }), rm(join(this.directory, `${id}.json`), { force: true })]);
  }
}
