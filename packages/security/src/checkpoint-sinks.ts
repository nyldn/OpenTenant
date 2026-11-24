import { createHash, randomUUID } from "node:crypto";
import { runFixedCommandSync } from "./subprocess";
import { link, lstat, mkdir, open, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuditCheckpointError } from "@opentenant/security/audit-checkpoint";

/** publish resolves only after durable external storage. No cloud or network API. */
export interface CheckpointSink {
  publish(note: string): Promise<void>;
  read(): Promise<readonly string[]>;
}

export class FileCheckpointSink implements CheckpointSink {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  async paths(): Promise<string[]> {
    let names: string[];
    try { names = await readdir(this.directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return names.filter((name) => /^[a-f0-9]{64}\.checkpoint$/u.test(name)).sort().map((name) => join(this.directory, name));
  }

  async read(): Promise<string[]> {
    return Promise.all((await this.paths()).map(async (path) => {
      if (!(await lstat(path)).isFile()) throw new AuditCheckpointError("checkpoint file must be regular");
      return readFile(path, "utf8");
    }));
  }

  async publish(note: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${createHash("sha256").update(note).digest("hex")}.checkpoint`);
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(note); await file.sync(); } finally { await file.close(); }
    try {
      try { await link(temporary, path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!(await lstat(path)).isFile() || await readFile(path, "utf8") !== note) throw new AuditCheckpointError("checkpoint file conflict");
      }
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary); }
  }
}

/** A dedicated, clean local repository. Commits only; never pushes or fetches. */
export class GitCheckpointSink extends FileCheckpointSink {
  constructor(directory: string, private readonly executableSearchPath: string) { super(directory); }
  private git(args: string[]): string {
    try {
      return runFixedCommandSync("git", ["-C", this.directory, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
        // Git and configured filters never receive signer/database credentials.
        searchPath: this.executableSearchPath,
        env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
      }).trim();
    } catch { throw new AuditCheckpointError("checkpoint git operation failed"); }
  }
  private requireClean(): void {
    if (resolve(this.git(["rev-parse", "--show-toplevel"])) !== this.directory || this.git(["status", "--porcelain"]) !== "") throw new AuditCheckpointError("checkpoint git repository must be dedicated and clean");
  }
  override async read(): Promise<string[]> {
    this.requireClean();
    return super.read();
  }
  override async publish(note: string): Promise<void> {
    const lock = join(this.directory, ".git", "audit-checkpoint.lock");
    try { await mkdir(lock); } catch { throw new AuditCheckpointError("checkpoint git repository unavailable or busy"); }
    try {
      this.requireClean();
      await super.publish(note);
      const name = `${createHash("sha256").update(note).digest("hex")}.checkpoint`;
      if (this.git(["status", "--porcelain", "--", name]) !== "") {
        this.git(["add", "--", name]);
        this.git(["commit", "-m", "chore(audit): anchor signed checkpoint", "--", name]);
      }
    } finally { await rmdir(lock); }
  }
}
