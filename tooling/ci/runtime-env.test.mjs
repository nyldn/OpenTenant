import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedEnvironmentResiduals, environmentExclusions, runtimeEnvironmentRules } from "../config/environment-policy.mjs";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const runtimePaths = ["apps/platform/lib/runtime.ts", "packages/auth/src/runtime.ts", "modules/brain/src/runtime.ts"];
const boundaryErrors = result => result.messages.filter(message => Object.hasOwn(runtimeEnvironmentRules, message.ruleId) && message.severity === 2);

const originalProbes = [
  "void process.env.KEY;", 'void process["env"].KEY;', 'const { env } = process; void env;',
  'const { env: settings } = process; void settings;', 'const { FOO } = process.env; void FOO;',
  'let env; ({ env } = process); void env;', 'import { env } from "node:process"; void env;',
  'import process from "node:process"; void process;', 'import * as proc from "process"; void proc;',
  'import { env } from "process"; void env;', 'const proc = require("node:process"); void proc;',
  'void import("process");', 'const p = process; void p;', 'let p; p = process; void p;',
  'void Reflect.get(process, "env");', 'const copy = { ...process }; void copy;',
  'void globalThis.process.env.KEY;', 'void globalThis["process"].env.KEY;', 'void global.process.env.KEY;',
];
// The independent grader's 14 runtime-successful escapes, each in every root.
const graderProbes = [
  'const key = "env"; void process[key].KEY;',
  'void process["en" + "v"].KEY;',
  'void process[`env`].KEY;',
  'const root = globalThis; void root.process.env.KEY;',
  'const { process: proc } = globalThis; void proc.env.KEY;',
  'void Reflect.get(globalThis, "process").env.KEY;',
  'void Object.getOwnPropertyDescriptor(globalThis, "process").get().env.KEY;',
  'void Object.getOwnPropertyDescriptors(globalThis).process.get().env.KEY;',
  'void process.getBuiltinModule("node:process").env.KEY;',
  'import { createRequire } from "node:module"; const loaders = { load: createRequire(import.meta.url) }; void loaders.load("node:process").env.KEY;',
  'const name = "node:process"; void (await import(name)).env.KEY;',
  'const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(globalThis)); void copy.process.env.KEY;',
  'void globalThis.global.process.env.KEY;',
  'void globalThis["pro" + "cess"].env.KEY;',
];
const furtherProbes = [
  // Alternate globals, optional chains, assignment aliases, and computed keys.
  'const root = global; void root.process.env.KEY;',
  'const { process: proc } = self; void proc.env.KEY;',
  'let root; ({ root } = { root: window }); void root.process.env.KEY;',
  'void globalThis?.process?.env.KEY;',
  'void process?.["en" + "v"]?.KEY;',
  'const p = (process as unknown); void p;',
  'void ({ [process]: 1 });',
  'const root = { ...globalThis }; void root.process.env.KEY;',
  'label: { const { process: proc } = globalThis; void proc.env.KEY; }',
  'let env; label: ({ env } = process); void env;',
  // Imported loaders and dynamic import sources are families, not one spelling.
  'import * as mod from "module"; void mod;',
  'export { createRequire } from "node:module";',
  'export * from "module";',
  'void require("module");',
  'void import("node:module");',
  'void import(`node:process`);',
  'void import("node:" + "process");',
  'void import(123);',
  'void import(true);',
  // Code generation, including aliases and constructor recovery.
  'eval("process.env.KEY");',
  '(0, eval)("process.env.KEY");',
  'const execute = eval; execute("process.env.KEY");',
  'void new Function("return process.env.KEY")();',
  'void Function("return process.env.KEY")();',
  'const Compiler = Function; void new Compiler("return process.env.KEY")();',
  'setTimeout("process.env.KEY", 0);',
  'setInterval("process.env.KEY", 0);',
  'void [].constructor.constructor("return process.env.KEY")();',
  'void []["constructor"]["constructor"]("return process.env.KEY")();',
  'void (async function () {}).constructor("return process.env.KEY")();',
  'void (function* () {}).constructor("yield process.env.KEY")().next();',
  'void (() => {}).constructor("return process.env.KEY")();',
  // All sensitive reflective operations with both kinds of ambient argument.
  ...["Object.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptors", "Reflect.get", "Reflect.ownKeys", "Object.defineProperties"].flatMap(operation => [
    `void ${operation}(globalThis, "process");`,
    `void ${operation}(process, "env");`,
  ]),
];
// Grading pass 5: loader and evaluation forms an author could write by accident.
const passFiveProbes = [
  'void module.require("node:process").env.KEY;',
  'const { env } = module.require("process"); void env.KEY;',
  'void require.main.require("process").env.KEY;',
  'void process.mainModule.require("process").env.KEY;',
  'const load = require; void load("node:process").env.KEY;',
  'const load = require; void load("node:" + "process").env.KEY;',
  'void exports;',
  'void process.binding("util");',
  'import vm from "node:vm"; void vm.runInThisContext("process.env.KEY");',
  'import { Script } from "vm"; void new Script("process.env.KEY").runInThisContext();',
  'import { Worker } from "node:worker_threads"; void new Worker("process.env.KEY", { eval: true });',
  'import { Worker } from "worker_threads"; void Worker;',
  'import inspector from "node:inspector"; void inspector;',
  // Diagnostic reports embed the full environment.
  'void process.report.getReport().environmentVariables.KEY;',
  // Grading pass 6: lazily loaded evaluators and inherited-environment children.
  'const { Worker } = await import("node:worker_threads"); void new Worker("process.env.KEY", { eval: true });',
  'const { Worker } = await import("worker_threads"); void Worker;',
  'void import("node:vm");', 'void import("inspector");', 'void import("node:inspector/promises");',
  'import { Session } from "node:inspector/promises"; void Session;',
  'import { Session } from "inspector/promises"; void Session;',
  'import { execFileSync } from "node:child_process"; void execFileSync("printenv", ["KEY"]);',
  'import { spawnSync } from "child_process"; void spawnSync("printenv", ["KEY"]);',
  'import { execSync } from "node:child_process"; void execSync(\'echo "$KEY"\');',
  'const { execSync } = await import("node:child_process"); void execSync("printf %s \\"$KEY\\"");',
  // Grading pass 7: fluent EventEmitter returns, listener this, and the command seam.
  'const p = process.on("exit", () => {}); void p.env.KEY;',
  'const p = process.once("exit", () => {}); void p.env.KEY;',
  'const p = process.setMaxListeners(20); void p.env.KEY;',
  'process.on("warning", function () { void this.env.KEY; });',
  'process.once("exit", function named() { const { env } = this; void env.KEY; });',
  'void process.emit("warning", new Error("x"));',
  'import { runFixedCommand } from "@opentenant/security/subprocess"; void runFixedCommand("ps", ["eww"], { allowedCommands: new Set(["ps"]) });',
];
const allowedProbes = [
  "process.exitCode = 1;", "void process.argv[2];", "process.stdout.write('x');",
  "process.stderr.write('x');", "process.stdin.resume();", "process.on('exit', () => {});",
  "process.once('SIGTERM', () => { void 0; });",
  "const job = { process: 'build' }; void job.process;", 'void ({ process: "build" })["process"];',
  "export interface Logs { readonly process: string }", "export class Job { process = 'build' }",
  'const job = { globalThis: 1, global: 2, self: 3, window: 4 }; void job.window;',
  'const window = { start: 0 }; void window.start;',
  'const model = { process: "build" }; void Object.getOwnPropertyDescriptor(model, "process");',
  'const model = { process: "build" }; void Object.getOwnPropertyDescriptors(model);',
  'const model = { process: "build" }; void Reflect.get(model, "process");',
  'const model = { process: "build" }; void Reflect.ownKeys(model);',
  'const model = { process: "build" }; void Object.defineProperties({}, Object.getOwnPropertyDescriptors(model));',
  'void import("nodemailer");', 'void import("./runtime.js");',
  'import { createHash } from "node:crypto"; void createHash;',
  'import { runFixedCommand } from "@opentenant/security/subprocess"; void runFixedCommand("tar", ["--version"]);',
];
const residualProbes = [
  { id: "module-this", source: 'void this?.process?.env.KEY;' },
  { id: "module-this", source: 'void (() => this)()?.process?.env.KEY;' },
  { id: "module-arguments", source: 'void arguments[0].process.env.KEY;' },
  { id: "module-arguments", source: 'function leak() { return arguments.callee.caller; } void leak();' },
  { id: "prototype-constructor", source: 'const Compiler = Object.getPrototypeOf(async function () {}).constructor; void Compiler("return process.env.KEY")();' },
  { id: "prototype-constructor", source: 'const prototype = Object.getPrototypeOf(() => {}); void prototype["con" + "structor"]("return process.env.KEY")();' },
  { id: "prototype-constructor", source: 'const first = [].constructor; const Compiler = first.constructor; void Compiler("return process.env.KEY")();' },
  { id: "browser-back-reference", source: 'void document.defaultView?.["pro" + "cess"].env.KEY;' },
  { id: "procfs-environ", source: 'import { readFileSync } from "node:fs"; void readFileSync("/proc/self/environ", "utf8");' },
];

for (const filePath of runtimePaths) {
  test(`runtime configuration boundary: ${filePath}`, async t => {
    const eslint = new ESLint({ cwd: root });
    for (const [family, probes] of [["original", originalProbes], ["grader", graderProbes], ["further", furtherProbes], ["pass-five", passFiveProbes]]) {
      for (const source of probes) await t.test(`${family}: ${source}`, async () => {
        const [result] = await eslint.lintText(source, { filePath });
        assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
        assert.ok(boundaryErrors(result).length > 0, `${filePath}: ${source}`);
      });
    }
    for (const source of allowedProbes) await t.test(`allowed: ${source}`, async () => {
      const [result] = await eslint.lintText(source, { filePath });
      assert.deepEqual(result.messages, [], source);
    });
    for (const { id, source } of residualProbes) await t.test(`accepted residual ${id}: ${source}`, async () => {
      assert.ok(acceptedEnvironmentResiduals.some(residual => residual.id === id && residual.reason.length > 30));
      const [result] = await eslint.lintText(source, { filePath });
      assert.equal(result.fatalErrorCount, 0, source);
      assert.deepEqual(boundaryErrors(result), [], source);
    });
    await t.test("with is rejected and cannot execute in strict-mode ESM", async () => {
      const [result] = await eslint.lintText('with ({}) { void 0; }', { filePath });
      assert.ok(result.fatalErrorCount > 0 || boundaryErrors(result).some(message => message.ruleId === "no-with"));
    });
  });
}

test("strict-mode ESM dead ends cannot recover ambient state", async () => {
  const esm = source => import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal((await esm('export default this')).default, undefined);
  assert.equal((await esm('export default (() => this)()')).default, undefined);
  await assert.rejects(esm('export default arguments'), ReferenceError);
  await assert.rejects(esm('function f() { return arguments.callee; } f();'), TypeError);
  await assert.rejects(esm('with ({}) {}'), SyntaxError);
  assert.ok(acceptedEnvironmentResiduals.every(residual => residualProbes.some(probe => probe.id === residual.id)));
});

test("all exemption reasons are recorded and operator entrypoints remain enforced", async () => {
  assert(environmentExclusions.every(entry => entry.reason.length > 30));
  const eslint = new ESLint({ cwd: root });
  for (const filePath of ["packages/database/src/audit-cli.ts", "packages/database/src/credential-cipher-rotate.ts"]) {
    const [result] = await eslint.lintText("void process.env.KEY;", { filePath });
    assert.ok(boundaryErrors(result).length > 0);
  }
  for (const filePath of ["packages/auth/src/runtime.test.ts", "modules/brain/src/runtime.spec.ts", ...environmentExclusions.filter(entry => !entry.path.includes("*")).map(entry => entry.path)]) {
    const [result] = await eslint.lintText("void process.env.KEY; void globalThis;", { filePath });
    assert.deepEqual(boundaryErrors(result), [], filePath);
  }
  const results = await eslint.lintFiles([...environmentExclusions.filter(entry => !entry.path.includes("*")).map(entry => entry.path), "apps/platform/instrumentation.ts"]);
  assert.deepEqual(results.flatMap(result => result.messages.filter(message => message.severity === 2)), []);
});
