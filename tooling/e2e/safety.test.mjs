import { PHASES } from "./audit/phases.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { hostEnvironment, postgresPort } from "./safety.mjs";
import { dnsControl } from "./dns-control.mjs";

test("database ports cannot collide with the default Postgres listener", async () => {
  for (const value of ["5432", "0", "-1", "65536", "abc", "5432/other"]) {
    assert.throws(() => postgresPort(value));
  }
  assert.equal(await postgresPort("55433"), 55433);
  const allocated = await postgresPort();
  assert.ok(allocated > 1023 && allocated !== 5432);
});

test("DNS control starts empty, replaces answers and rejects hostile control requests", async () => {
  const server = dnsControl();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/__e2e/dns`;
  const record = "_opentenant-challenge.app.customer.test";
  const post = (data, headers = {}) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
  });
  try {
    assert.deepEqual(await (await fetch(`${url}?record=${record}`)).json(), []);
    assert.equal((await post({ record, records: [["synthetic"]] })).status, 200);
    assert.deepEqual(await (await fetch(`${url}?record=${record}`)).json(), [["synthetic"]]);
    assert.equal((await post({ record, records: [] })).status, 200);
    assert.deepEqual(await (await fetch(`${url}?record=${record}`)).json(), []);
    assert.equal((await post({ record, records: [42] })).status, 400);
    assert.equal((await post({ record, records: [] }, { Origin: "https://hostile.example.test" })).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      const req = httpRequest(url, { method: "POST", headers: { Host: "hostile.example.test" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.once("error", reject);
      req.end(JSON.stringify({ record, records: [] }));
    });
    assert.equal(rebound, 403);
    assert.equal((await post({ record, records: [["x".repeat(8192)]] })).status, 413);
    assert.equal((await fetch(url, { method: "DELETE" })).status, 405);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("host credentials, provider choices, and Node injection do not reach children", () => {
  assert.deepEqual(hostEnvironment({
    PATH: "/test/bin", HOME: "/test/home", CI: "1",
    WORKOS_API_KEY: "synthetic", OPENAI_API_KEY: "synthetic",
    CONTROL_PLANE_DATABASE_URL: "synthetic", NODE_OPTIONS: "--require=untrusted.cjs",
    IDENTITY_PROVIDER: "workos",
  }), { PATH: "/test/bin", HOME: "/test/home", CI: "1" });
});

test("listing both phases succeeds without Docker or execution summaries", async () => {
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync(process.execPath, [new URL("run.mjs", import.meta.url).pathname, "--list"], { encoding: "utf8", env: { ...process.env, E2E_USE_POSTGRES_SERVICE: "1", E2E_POSTGRES_PORT: "invalid" } });
  const journeyPhases = Object.entries(PHASES).filter(([name, phase]) => name !== "audit" && !phase.runner);
  const collected = [...output.matchAll(/^Total: (\d+) tests in \d+ files?$/gm)]
    .slice(0, journeyPhases.length).reduce((sum, match) => sum + Number(match[1]), 0);
  assert.equal(collected, journeyPhases.reduce((sum, [, phase]) => sum + phase.count, 0));
  assert.match(output, /no tests executed/);
  assert.doesNotMatch(output, /E2E total:/);
});
