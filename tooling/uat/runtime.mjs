import { readFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { FIXTURE_VERSION } from "./brand-assets.mjs";

export function manifestFor({ runId, worktree, appPort, nextPort, mailPort, smtpPort, postgresPort, dnsPort, upstreamPort, users, tenants, mode, identityProvider = mode === "start" ? "better-auth" : "local" }) {
  const origin = slug => `http://${slug}.localhost:${appPort}`;
  return {
    version: 1, fixtureVersion: FIXTURE_VERSION, fixtureRevision: 0, runId, worktree, mode, identityProvider, adminHost: `${origin("admin")}/admin`,
    mailpitUrl: `http://127.0.0.1:${mailPort}`,
    ports: { app: appPort, next: nextPort, mailpit: mailPort, smtp: smtpPort, postgres: postgresPort, dns: dnsPort, upstream: upstreamPort },
    tenants: tenants.map(t => ({ ...t, url: `${origin(t.slug)}/` })),
    personas: users.map(user => ({ id: user.id === "workspace-owner" ? "installation-owner" : user.id, email: user.email, role: user.role, tenantId: user.tenant, isPlatformAdmin: user.isPlatformAdmin,
      signInUrl: `${origin(user.id === "workspace-owner" ? "admin" : user.slug)}/__uat/sign-in?token=${user.token}`,
      cookie: { name: mode === "start" ? "__Secure-opentenant_session" : "opentenant_session", secure: mode === "start", value: identityProvider === "local" ? user.token : user.cookie, httpOnly: true, sameSite: "Lax", path: "/" },
    })),
    ssh: { ports: [appPort, mailPort], command: `ssh -N -L ${appPort}:127.0.0.1:${appPort} -L ${mailPort}:127.0.0.1:${mailPort} USER@HOST` },
  };
}

/** Reverse order, idempotent teardown. A failed disposer never skips the rest. */
export function resources() {
  const disposers = [];
  let cleanup;
  return {
    add(dispose) { disposers.push(dispose); },
    dispose() {
      cleanup ??= (async () => {
        const failures = [];
        for (const dispose of disposers.reverse()) {
          try { await dispose(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "UAT teardown failed");
      })();
      return cleanup;
    },
  };
}

export function childProcess(command, args, { ledger, ...options }) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stamp;
  child.once("spawn", () => {
    try {
      stamp = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1].split(" ")[19];
      ledger?.write(JSON.stringify({ pid: child.pid, stamp }) + "\n");
    } catch { /* Parent-death process cleanup uses Linux process identities. */ }
  });
  const secrets = Object.entries(options.env ?? {}).filter(([key, value]) => value && /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/u.test(key)).map(([, value]) => value);
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    const redact = line => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), line).replace(/postgres(?:ql)?:\/\/[^\s'"]+/gu, "[database URL redacted]");
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      pending += chunk;
      const end = pending.lastIndexOf("\n");
      if (end >= 0) { process.stderr.write(redact(pending.slice(0, end + 1))); pending = pending.slice(end + 1); }
    });
    stream.on("end", () => { if (pending) process.stderr.write(redact(pending)); });
  }
  const exited = new Promise(resolve => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => { if (stamp) ledger?.write(JSON.stringify({ pid: child.pid, stamp, remove: true }) + "\n"); resolve(signal ? 1 : code ?? 1); });
  });
  return { child, exited, async dispose() {
    if (!child.pid || child.exitCode !== null || child.signalCode) return;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
    kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), delay(8000, false, { ref: false })]) === false) {
      kill("SIGKILL");
      await exited;
    }
  } };
}

export async function waitFor(url, signal, acceptedStatuses = [200]) {
  for (let attempt = 0; attempt < 180; attempt++) {
    signal?.throwIfAborted();
    try { if (acceptedStatuses.includes((await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]) })).status)) return; }
    catch { /* Startup is bounded; cancellation is checked on every retry. */ }
    await delay(500, undefined, { signal });
  }
  throw new Error("UAT service readiness timed out");
}

export const docker = args => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

export function gateway({ appPort, nextPort, users, tenants: _tenants, documents, mode, identityProvider = mode === "start" ? "better-auth" : "local", demo = false, stopToken, stop, reset, operator, revision = () => "0" }) {
  const allowedHost = host => typeof host === "string" && new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\\.localhost:${appPort}$`, "u").test(host);
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const host = req.headers.host;
    if (!allowedHost(host)) { res.writeHead(404).end(); return; }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith("/__uat/")) {
      if (req.headers.origin && req.headers.origin !== url.origin) { res.writeHead(403).end(); return; }
      if (url.pathname === "/__uat/stop" && req.method === "POST" && req.headers.authorization === `Bearer ${stopToken}`) {
        res.end("Stopping"); setImmediate(stop); return;
      }
      if (url.pathname === "/__uat/reset" && req.method === "POST" && req.headers.authorization === `Bearer ${stopToken}` && reset) {
        res.setHeader("Content-Type", "application/json");
        void reset().then(receipt => res.end(JSON.stringify(receipt)), () => res.writeHead(503).end('{"error":"reset_failed"}'));
        return;
      }
      if (url.pathname === "/__uat/control" && req.method === "POST" && host === `admin.localhost:${appPort}` && req.headers.authorization === `Bearer ${stopToken}` && operator) {
        operatorRequest(req, res, operator);
        return;
      }
      const user = users.find(user => user.token === url.searchParams.get("token"));
      if (url.pathname !== "/__uat/sign-in" || req.method !== "GET" || !user) { res.writeHead(404).end(); return; }
      // Installation/support sessions may be copied to a tenant host explicitly.
      // Tenant sessions remain exactly tenant-bound in the identity adapter.
      res.setHeader("Set-Cookie", `${mode === "start" ? "__Secure-opentenant_session" : "opentenant_session"}=${identityProvider === "local" ? user.token : user.cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${mode === "start" ? "; Secure" : ""}`);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const document = documents[user.tenant];
      const data = JSON.stringify(document ? { key: `assessment_engagement_v2:${encodeURIComponent(user.tenant)}`, value: JSON.stringify(document) } : null).replaceAll("<", "\\u003c");
      const home = demo && user.id === "alpha-owner" && host === "alpha.localhost:" + appPort ? "/support" : "/";
      const target = host.startsWith("admin.") ? "/admin" : user.id === "managed-support" ? "/admin/support" : user.id === "no-memberships" ? "/tenants" : home;
      res.end(`<!doctype html><title>UAT sign-in</title><script>const rev=${JSON.stringify(revision())};if(localStorage.getItem("__uat_revision")!==rev){for(const k of Object.keys(localStorage)){if(k.startsWith("assessment_"))localStorage.removeItem(k)}localStorage.setItem("__uat_revision",rev)}const seed=${data};if(seed&&!localStorage.getItem(seed.key))localStorage.setItem(seed.key,seed.value);location.replace(${JSON.stringify(target)})</script>`);
      return;
    }
    // Validate the browser origin before adapting it to Next CLI's internal
    // absolute request URL. The dev DNS entry restores its own public URL.
    const headers = { ...req.headers };
    if (headers.origin) {
      if (headers.origin !== url.origin) { res.writeHead(403).end(); return; }
      const hostBound = url.pathname.startsWith("/api/auth/better-auth/")
        || url.pathname.startsWith("/auth/better-auth/")
        || url.pathname === "/auth/logout"
        || (mode === "dev" && url.pathname === "/api/settings/domains");
      if (!hostBound) headers.origin = `http://localhost:${nextPort}`;
    }
    headers["x-forwarded-host"] = `localhost:${nextPort}`;
    headers["x-forwarded-proto"] = "http";
    const proxy = request({ hostname: "127.0.0.1", port: nextPort, path: req.url, method: req.method, headers }, upstream => {
      const responseHeaders = { ...upstream.headers };
      if (responseHeaders.location) {
        const redirect = new URL(responseHeaders.location, `http://127.0.0.1:${nextPort}`);
        if ([`http://127.0.0.1:${nextPort}`, `http://localhost:${nextPort}`].includes(redirect.origin)) {
          redirect.host = host;
          responseHeaders.location = redirect.href;
        }
      }
      res.writeHead(upstream.statusCode, responseHeaders); upstream.pipe(res);
    });
    proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("UAT platform unavailable"); });
    req.on("aborted", () => proxy.destroy());
    req.pipe(proxy);
  });
  // Preserve Next dev's HMR websocket without listening on another interface.
  server.on("upgrade", (req, socket, head) => {
    if (!allowedHost(req.headers.host)) { socket.destroy(); return; }
    const proxy = request({ hostname: "127.0.0.1", port: nextPort, path: req.url, headers: req.headers });
    proxy.on("upgrade", (upstream, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstream.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      upstreamSocket.write(head); socket.write(upstreamHead);
      socket.pipe(upstreamSocket).pipe(socket);
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => socket.destroy());
    });
    proxy.on("error", () => socket.destroy()); proxy.end();
  });
  const sockets = new Set();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  return { server, async dispose() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

function operatorRequest(req, res, operator) {
  let body = "";
  let bytes = 0;
  res.setHeader("Content-Type", "application/json");
  req.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 1024) { if (!res.writableEnded) res.writeHead(413).end('{"error":"control_refused"}'); }
    else body += chunk;
  });
  req.on("error", () => { if (!res.writableEnded) res.writeHead(400).end('{"error":"control_refused"}'); });
  req.on("end", () => {
    if (res.writableEnded) return;
    void Promise.resolve().then(() => operator(JSON.parse(body)))
      .then(receipt => res.end(JSON.stringify(receipt)), () => res.writeHead(409).end('{"error":"control_refused"}'));
  });
}
