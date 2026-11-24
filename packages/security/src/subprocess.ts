/**
 * The only runtime entry point for starting child processes.
 *
 * Children never inherit the parent's environment. They receive a fixed
 * system search path plus the explicit variables a caller names, so a child
 * command (including one that prints its environment) cannot observe database
 * URLs, signing keys or provider credentials. Commands run without a shell.
 */
import { execFile, execFileSync } from "node:child_process";

/** Fixed system search path; never read from the parent environment. */
export const SYSTEM_SEARCH_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export interface FixedCommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Overrides the fixed search path, for example a pinned toolchain directory. */
  readonly searchPath?: string;
  /** Explicit, reviewed variables for the child. Nothing else is passed. */
  readonly env?: Readonly<Record<string, string>>;
  /** Test seam only: narrows or replaces the reviewed command set. */
  readonly allowedCommands?: ReadonlySet<string>;
}

const COMMAND_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;

/**
 * Runtime commands are a closed, reviewed set. Diagnostics such as ps or cat
 * could read another process's environment from the OS, so they are not
 * runnable through this boundary.
 */
export const RUNTIME_COMMANDS: ReadonlySet<string> = new Set(["tar", "git"]);

export function scrubbedEnvironment(options: FixedCommandOptions = {}): Record<string, string> {
  const extra = options.env ?? {};
  if (Object.hasOwn(extra, "PATH")) throw new Error("Pass searchPath instead of PATH");
  return { ...extra, PATH: options.searchPath ?? SYSTEM_SEARCH_PATH };
}

function checkedCommand(file: string, allowed: ReadonlySet<string>): string {
  if (!COMMAND_NAME.test(file)) throw new Error("Command must be a bare executable name");
  if (!allowed.has(file)) throw new Error(`Command is not in the reviewed runtime set: ${file}`);
  return file;
}

export function runFixedCommandSync(file: string, args: readonly string[], options: FixedCommandOptions = {}): string {
  return execFileSync(checkedCommand(file, options.allowedCommands ?? RUNTIME_COMMANDS), [...args], {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: scrubbedEnvironment(options),
  });
}

export function runFixedCommand(file: string, args: readonly string[], options: FixedCommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(checkedCommand(file, options.allowedCommands ?? RUNTIME_COMMANDS), [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      encoding: "utf8",
      shell: false,
      env: scrubbedEnvironment(options),
    }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
