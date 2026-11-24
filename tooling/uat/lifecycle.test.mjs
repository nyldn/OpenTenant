import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { supervise } from "./lifecycle.mjs";
test("TTL expires an actual process and runs shutdown exactly once", async () => {
  let calls = 0;
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const exited = new Promise(resolve => child.once("exit", resolve));
  await supervise({ expiresAt: Date.now()+50, launch: () => ({ exited }), shutdown: async () => { calls++; child.kill("SIGTERM"); await exited; } });
  assert.equal(calls, 1); assert.equal(child.signalCode, "SIGTERM");
});
test("normal exit runs cleanup without waiting for TTL", async () => {
  let calls = 0;
  await supervise({ expiresAt: Date.now()+60_000, launch: () => ({ exited: Promise.resolve() }), shutdown: async () => { calls++; } });
  assert.equal(calls, 1);
});
test("guardian kills only ledger-owned process groups after forced launcher death", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
  await new Promise(resolve => child.once("spawn", resolve));
  const stamp = (await readFile(`/proc/${child.pid}/stat`, "utf8")).split(") ")[1].split(" ")[19];
  const guardian = spawn(process.execPath, [new URL("./guardian.mjs", import.meta.url).pathname, "opentenant.uat.run="+"f".repeat(24)], { stdio: ["pipe", "ignore", "ignore"] });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    guardian.stdin.write(JSON.stringify({ pid: child.pid, stamp })+"\n");
    guardian.stdin.end(); // Kernel EOF is the same boundary as launcher SIGKILL.
    await new Promise(resolve => guardian.once("exit", resolve)); await exited;
    assert.equal(child.signalCode, "SIGKILL"); assert.equal(guardian.exitCode, 0);
  } finally { if (child.exitCode === null && !child.signalCode) process.kill(-child.pid, "SIGKILL"); }
});
test("SIGKILL of an actual launcher closes its guardian pipe and kills its worker", async () => {
  const { setTimeout: delay } = await import("node:timers/promises");
  const source = `
    import {spawn} from 'node:child_process';
    import {readFileSync} from 'node:fs';
    const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    const guardian=spawn(process.execPath,[process.argv[1],'opentenant.uat.run='+'e'.repeat(24)],{stdio:['pipe','ignore','ignore']});
    worker.once('spawn',()=>{
      const stamp=readFileSync('/proc/'+worker.pid+'/stat','utf8').split(') ')[1].split(' ')[19];
      guardian.stdin.write(JSON.stringify({pid:worker.pid,stamp})+'\\n');
      console.log(JSON.stringify({worker:worker.pid,guardian:guardian.pid}));
    });
    setInterval(()=>{},1000);
  `;
  const launcher = spawn(process.execPath, ["--input-type=module", "-e", source, new URL("./guardian.mjs", import.meta.url).pathname], { stdio: ["ignore", "pipe", "ignore"] });
  const ids = await new Promise((resolve, reject) => { launcher.stdout.once("data", data => resolve(JSON.parse(data.toString()))); launcher.once("error", reject); });
  const alive = async pid => {
    try { return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1][0] !== "Z"; }
    catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
  };
  const kill = pid => { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  try {
    launcher.kill("SIGKILL"); await new Promise(resolve => launcher.once("exit", resolve));
    for (let i = 0; i < 200 && (await alive(ids.worker) || await alive(ids.guardian)); i++) await delay(50);
    assert.equal(await alive(ids.worker), false); assert.equal(await alive(ids.guardian), false);
  } finally {
    for (const pid of [ids.worker, ids.guardian, launcher.pid]) if (await alive(pid)) kill(pid);
  }
});
