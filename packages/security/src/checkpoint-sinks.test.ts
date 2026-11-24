import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signCheckpoint } from "./audit-checkpoint";
import { FileCheckpointSink, GitCheckpointSink } from "./checkpoint-sinks";
const key = generateKeyPairSync("ed25519");
const note = signCheckpoint({ origin: "example.test/audit/platform", sequence: 2, hash: "b".repeat(64) }, "dev", key.privateKey);
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), "audit-sink-")); directories.push(dir); return dir; }

describe("checkpoint sinks", () => {
  it("appends immutable files, retries idempotently, and rejects overwrite", async () => {
    const sink = new FileCheckpointSink(await directory());
    await sink.publish(note); await sink.publish(note);
    expect(await sink.read()).toEqual([note]);
    const [path] = await sink.paths();
    await writeFile(path!, "corrupt");
    await expect(sink.publish(note)).rejects.toThrow("conflict");
    expect(await readFile(path!, "utf8")).toBe("corrupt");
  });
  it("commits files to a dedicated local git repository without a remote", async () => {
    const dir = await directory();
    execFileSync("git", ["init", "--quiet", dir]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Audit Test"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "audit@example.test"]);
    const sink = new GitCheckpointSink(dir, process.env.PATH ?? "");
    await sink.publish(note); await sink.publish(note);
    expect(await sink.read()).toEqual([note]);
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("1");
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
  });
  it("keeps signing and database secrets out of git subprocesses", async () => {
    const dir = await directory();
    execFileSync("git", ["init", "--quiet", dir]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Audit Test"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "audit@example.test"]);
    // Local Git filters are executable repository configuration. Even a
    // configured filter must never inherit the signer's environment.
    await writeFile(join(dir, "filter.cjs"), 'if (process.env.AUDIT_CHECKPOINT_PRIVATE_KEY || process.env.AUDIT_DATABASE_URL) process.exit(1); process.stdin.pipe(process.stdout);');
    await writeFile(join(dir, ".gitattributes"), '*.checkpoint filter=audit\n');
    execFileSync("git", ["-C", dir, "config", "filter.audit.clean", `node ${join(dir, "filter.cjs")}`]);
    execFileSync("git", ["-C", dir, "config", "filter.audit.required", "true"]);
    execFileSync("git", ["-C", dir, "add", ".gitattributes", "filter.cjs"]);
    execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: prepare local filter"]);
    vi.stubEnv("AUDIT_CHECKPOINT_PRIVATE_KEY", "synthetic-private-key");
    vi.stubEnv("AUDIT_DATABASE_URL", "synthetic-database-secret");
    await new GitCheckpointSink(dir, process.env.PATH ?? "").publish(note);
    expect(await new GitCheckpointSink(dir, process.env.PATH ?? "").read()).toEqual([note]);
  });
  it("refuses a dirty git repository without committing unrelated changes", async () => {
    const dir = await directory(); execFileSync("git", ["init", "--quiet", dir]);
    await writeFile(join(dir, "unrelated"), "preserve");
    await expect(new GitCheckpointSink(dir, process.env.PATH ?? "").publish(note)).rejects.toThrow("clean");
  });
});
