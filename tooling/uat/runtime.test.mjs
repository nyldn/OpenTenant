import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { manifestFor, resources, childProcess, gateway } from "./runtime.mjs";

const user = { id: "alpha-owner", slug: "alpha", tenant: "tenant_alpha", user: "user_alpha", email: "alpha@example.test", role: "tenant_owner", token: "synthetic-only", cookie: "signed-synthetic", isPlatformAdmin: false };
const tenants = [{ slug: "alpha", tenantId: "tenant_alpha" }, { slug: "fresh", tenantId: "tenant_fresh", empty: true }];
test("manifest contains tenant/persona URLs, token cookie and only browser tunnel ports", () => {
  const manifest = manifestFor({ runId: "synthetic-run", appPort: 31001, nextPort: 31006, mailPort: 31002, smtpPort: 31003, postgresPort: 31004, dnsPort: 31005, upstreamPort: 31007, users: [user], tenants, mode: "dev" });
  assert.equal(manifest.version, 1);
  assert.equal(manifest.fixtureVersion, 2);
  assert.equal(manifest.adminHost, "http://admin.localhost:31001/admin");
  assert.equal(manifest.mailpitUrl, "http://127.0.0.1:31002");
  assert.deepEqual(manifest.tenants.map(t => t.url), ["http://alpha.localhost:31001/", "http://fresh.localhost:31001/"]);
  assert.equal(new URL(manifest.personas[0].signInUrl).searchParams.get("token"), user.token);
  assert.deepEqual(manifest.ssh.ports, [31001, 31002]);
  assert.equal(manifest.ssh.command, "ssh -N -L 31001:127.0.0.1:31001 -L 31002:127.0.0.1:31002 USER@HOST");
  assert.equal(manifest.personas[0].cookie.httpOnly, true);
  assert.ok(!JSON.stringify(manifest).includes("0.0.0.0"));
});

test("teardown runs every resource once in reverse order even after failure", async () => {
  const owned = resources();
  const calls = [];
  owned.add(async () => { calls.push("container"); });
  owned.add(async () => { calls.push("worker"); throw new Error("synthetic failure"); });
  owned.add(async () => { calls.push("platform"); });
  await assert.rejects(owned.dispose(), AggregateError);
  await assert.rejects(owned.dispose(), AggregateError);
  assert.deepEqual(calls, ["platform", "worker", "container"]);
});

test("teardown terminates an actual long-running child process", async () => {
  const owned = resources();
  const child = childProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: {} });
  owned.add(() => child.dispose());
  await new Promise(resolve => child.child.once("spawn", resolve));
  await owned.dispose();
  assert.equal(child.child.signalCode, "SIGTERM");
  assert.throws(() => process.kill(child.child.pid, 0), { code: "ESRCH" });
});

test("sign-in is loopback-only, host-only, no-store and rejects unknown tokens and foreign origins", async () => {
  const app = gateway({ appPort: 0, nextPort: 1, users: [user], tenants, documents: {}, mode: "dev", stopToken: "stop", stop() {} });
  // Allocate first, then create the gateway with its exact allowed Host port.
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  await app.dispose();
  const bound = gateway({ appPort: port, nextPort: 1, users: [user], tenants, documents: {}, mode: "dev", demo: true, stopToken: "stop", stop() {} });
  await new Promise(resolve => bound.server.listen(port, "127.0.0.1", resolve));
  const get = (token, host = `alpha.localhost:${port}`, origin) => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${port}/__uat/sign-in?token=${token}`, { headers: { host, ...(origin ? { origin } : {}) } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject); req.end();
  });
  try {
    assert.equal(bound.server.address().address, "127.0.0.1");
    const response = await get(user.token);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /location\.replace\("\/support"\)/u);
    assert.match((await get(user.token, "fresh.localhost:" + port)).body, /location\.replace\("\/"\)/u);
    assert.match(response.headers["set-cookie"][0], /HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(response.headers["set-cookie"][0], /Domain=/);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal((await get("wrong")).statusCode, 404);
    assert.equal((await get(user.token, "foreign.test")).statusCode, 404);
    assert.equal((await get(user.token, `alpha.localhost:${port}`, "https://foreign.test")).statusCode, 403);
  } finally { await bound.dispose(); }
});

test("gateway preserves the public origin for form redirects and validates POST origins", async () => {
  const { createServer } = await import("node:http");
  let receivedOrigin;
  const upstream = createServer((req, res) => {
    receivedOrigin = req.headers.origin;
    res.writeHead(303, { location: `http://127.0.0.1:${upstream.address().port}/support` }).end();
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const { freePort } = await import("../e2e/safety.mjs");
  const port = await freePort();
  const nextPort = upstream.address().port;
  const app = gateway({ appPort: port, nextPort, users: [user], tenants, documents: {}, mode: "dev", stopToken: "stop", stop() {} });
  await new Promise(resolve => app.server.listen(port, "127.0.0.1", resolve));
  const post = origin => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${port}/api/example`, { method: "POST", headers: { host: `alpha.localhost:${port}`, origin } }, res => { res.resume(); resolve(res); });
    req.once("error", reject); req.end();
  });
  try {
    const response = await post(`http://alpha.localhost:${port}`);
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, `http://alpha.localhost:${port}/support`);
    assert.equal(receivedOrigin, `http://localhost:${nextPort}`);
    assert.equal((await post("http://foreign.localhost:1234")).statusCode, 403);
  } finally { await app.dispose(); await new Promise(resolve => upstream.close(resolve)); }
});

test("gateway preserves validated Better Auth origins and rewrites non-auth origins", async () => {
  const { createServer } = await import("node:http");
  const received = [];
  const upstream = createServer((req, res) => {
    received.push({ path: req.url, origin: req.headers.origin });
    res.writeHead(204).end();
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const { freePort } = await import("../e2e/safety.mjs");
  const port = await freePort();
  const nextPort = upstream.address().port;
  const app = gateway({ appPort: port, nextPort, users: [user], tenants, documents: {}, mode: "dev", stopToken: "stop", stop() {} });
  await new Promise(resolve => app.server.listen(port, "127.0.0.1", resolve));
  const post = (path, origin) => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { host: `alpha.localhost:${port}`, origin } }, res => { res.resume(); resolve(res); });
    req.once("error", reject); req.end();
  });
  try {
    const publicOrigin = `http://alpha.localhost:${port}`;
    for (const path of ["/api/auth/better-auth/sign-out", "/auth/better-auth/login", "/auth/logout", "/auth/logout/other", "/api/example"]) {
      assert.equal((await post(path, publicOrigin)).statusCode, 204);
      const rewritten = path === "/api/example" || path === "/auth/logout/other";
      assert.deepEqual(received.at(-1), { path, origin: rewritten ? `http://localhost:${nextPort}` : publicOrigin });
      const count = received.length;
      assert.equal((await post(path, "http://foreign.localhost:1234")).statusCode, 403);
      assert.equal(received.length, count);
    }
  } finally { await app.dispose(); await new Promise(resolve => upstream.close(resolve)); }
});

test("operator endpoint requires its private token/admin host, bounds bodies and hides errors", async () => {
  const { freePort } = await import("../e2e/safety.mjs");
  const port = await freePort();
  let calls = 0;
  const app = gateway({ appPort: port, nextPort: 1, users: [], tenants: [], documents: {}, mode: "dev", stopToken: "synthetic-control-token", stop() {}, operator: async input => {
    calls++;
    if (input.action !== "status") throw new Error("secret-synthetic-driver-detail");
    return { runId: "synthetic-run", armed: false };
  } });
  await new Promise(resolve => app.server.listen(port, "127.0.0.1", resolve));
  const post = (body, token = "synthetic-control-token", host = `admin.localhost:${port}`) => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${port}/__uat/control`, { method: "POST", headers: { host, authorization: `Bearer ${token}` } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", c => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject); req.end(body);
  });
  try {
    assert.equal((await post('{"action":"status"}', "wrong")).status, 404);
    assert.equal((await post('{"action":"status"}', undefined, `alpha.localhost:${port}`)).status, 404);
    assert.equal(calls, 0);
    assert.equal((await post('{"action":"status"}')).status, 200);
    assert.equal((await post("x".repeat(1025))).status, 413);
    assert.equal((await post("not-json")).status, 409);
    const failed = await post('{"action":"failure"}');
    assert.deepEqual(failed, { status: 409, body: '{"error":"control_refused"}' });
    assert.equal(calls, 2);
  } finally { await app.dispose(); }
});
