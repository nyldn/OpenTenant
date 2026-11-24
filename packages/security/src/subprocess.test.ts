import { describe, expect, it } from "vitest";
import { RUNTIME_COMMANDS, runFixedCommand, runFixedCommandSync, scrubbedEnvironment, SYSTEM_SEARCH_PATH } from "./subprocess";

// Probes need diagnostic commands; production callers get only RUNTIME_COMMANDS.
const probe = { allowedCommands: new Set(["printenv", "env", "echo", "sh"]) };

describe("fixed subprocess boundary", () => {
  it("never passes inherited variables to the child", async () => {
    process.env.OPENTENANT_SUBPROCESS_PROBE = "secret-value";
    try {
      expect(runFixedCommandSync("printenv", ["OPENTENANT_SUBPROCESS_PROBE"], probe).trim()).toBe("");
    } catch (error) {
      // printenv exits 1 when the variable is absent, which is the expected outcome.
      expect((error as { status?: number }).status).toBe(1);
    }
    await expect(runFixedCommand("printenv", ["OPENTENANT_SUBPROCESS_PROBE"], probe)).rejects.toBeTruthy();
    delete process.env.OPENTENANT_SUBPROCESS_PROBE;
  });

  it("passes only the fixed search path and explicit variables", async () => {
    const output = await runFixedCommand("env", [], { ...probe, env: { GIT_TERMINAL_PROMPT: "0" } });
    const names = output.trim().split("\n").map((line) => line.split("=")[0]).sort();
    expect(names).toEqual(["GIT_TERMINAL_PROMPT", "PATH"]);
    expect(scrubbedEnvironment()).toEqual({ PATH: SYSTEM_SEARCH_PATH });
  });

  it("runs without a shell and rejects paths, shell syntax and PATH overrides", async () => {
    expect((await runFixedCommand("echo", ["$HOME", "`id`"], probe)).trim()).toBe("$HOME `id`");
    expect(() => runFixedCommandSync("/bin/sh", ["-c", "env"])).toThrow("bare executable");
    expect(() => runFixedCommandSync("sh -c env", [])).toThrow("bare executable");
    expect(() => scrubbedEnvironment({ env: { PATH: "/tmp" } })).toThrow("searchPath");
  });

  it("refuses commands outside the reviewed runtime set", () => {
    expect([...RUNTIME_COMMANDS].sort()).toEqual(["git", "tar"]);
    for (const command of ["ps", "cat", "printenv", "env", "sh", "node"]) {
      expect(() => runFixedCommandSync(command, [])).toThrow("reviewed runtime set");
    }
  });
});
