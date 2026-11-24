import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { readdirSync, readlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { images, root, docker, ownedContainer } from "./docker.mjs";
import { freePort } from "../e2e/safety.mjs";

export const routeReceipt = join(root, "docs/reviews/2026-11-17-developer-mcp-route.json");
const platformRequire = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
const sandboxRequire = createRequire(new URL("../../packages/sandbox/package.json", import.meta.url));
const e2eRequire = createRequire(new URL("../e2e/package.json", import.meta.url));

function check(condition, message) { assert.ok(condition, message); }
function redacted(value) {
  let text = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|CANARY/u.test(name)) text = text.replaceAll(secret, "[redacted]");
  }
  return text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gu, "[database URL]").replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]");
}

/** Start only inside a forge-job and an already provisioned db:ephemeral E2E run. */
export async function startDeveloperRouteProof() {
  const source = process.env.CONTROL_PLANE_DATABASE_URL;
  check(source && ["127.0.0.1", "localhost"].includes(new URL(source).hostname), "A loopback E2E database is required");
  const { Pool } = platformRequire("pg");
  const pool = new Pool({ connectionString: source, max: 2 });
  const directory = await mkdtemp(join(tmpdir(), "opentenant-developer-route-"));
  const container = ownedContainer();
  const projectId = randomBytes(16).toString("hex");
  const tenantId = `tenant_route_${projectId}`;
  const clientId = `route-${projectId}`;
  const session = randomBytes(32).toString("hex");
  const canary = randomBytes(32).toString("hex");
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const receiver = createServer((_request, response) => response.end("Authorized"));
  const listener = createServer((_request, response) => response.end("Synthetic host listener"));
  let child;
  let logs = "";
  let disposed = false;
  await rm(routeReceipt, { force: true });
  async function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      await container.dispose();
      if (child && child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
      check(!docker(["ps", "-aq", "--filter", `name=^/${container.name}$`]).trim(), "Route container remains");
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => { socket.destroy(); reject(new Error("Route listener remains")); });
        socket.once("error", error => error.code === "ECONNREFUSED" ? resolve() : reject(error));
      });
    } finally {
      receiver.closeAllConnections(); listener.closeAllConnections();
      await Promise.all([receiver, listener].map(server => new Promise(resolve => server.close(resolve))));
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    // No pulls: both runtime and guest come from this exact cached Docker pin.
    const local = JSON.parse(docker(["image", "inspect", images.node]))[0];
    check(local.RepoDigests.some(value => value.endsWith(images.node.split("@")[1])), "Pinned Node image is not cached; load the reviewed digest before retrying");
    sandboxRequire.resolve("microsandbox");
    const archive = join(directory, "image.tar");
    docker(["image", "save", "--output", archive, images.node]);
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", archive, "manifest.json"], { encoding: "utf8" }));
    const configBytes = execFileSync("tar", ["-xOf", archive, manifest[0].Config]);
    assert.deepEqual(JSON.parse(configBytes).rootfs.diff_ids, local.RootFS.Layers);
    await writeFile(join(directory, "image.json"), JSON.stringify({ config: `sha256:${createHash("sha256").update(configBytes).digest("hex")}`, layers: local.RootFS.Layers }), { mode: 0o600 });
    for (const server of [receiver, listener]) await new Promise((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    const redirect = `http://127.0.0.1:${receiver.address().port}/callback`;
    await pool.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values($1,$2,'Route proof','active','us'),($3,$4,'Foreign proof','active','us')", [tenantId, `r-${projectId}`, `${tenantId}_foreign`, `f-${projectId}`]);
    await pool.query("insert into developer_mcp.projects(id,tenant_id,user_id,client_id,profile,consent_scopes,active) values($1,$2,'user_route_proof',$3,'developer.builder@1',array['module.dev.workspace.create','module.dev.preview.open'],true)", [projectId, tenantId, clientId]);
    await pool.query("insert into developer_mcp.oauth_clients values($1,$2)", [clientId, redirect]);
    await pool.query("insert into developer_mcp.switches values($1,true)", [`tenant:${tenantId}`]);
    const environment = {
      NODE_ENV: "development", OPENTENANT_E2E: "1", NEXT_TELEMETRY_DISABLED: "1",
      CONTROL_PLANE_DATABASE_URL: source, IDENTITY_PROVIDER: "local",
      LOCAL_TENANT_ID: tenantId, LOCAL_USER_ID: "user_route_proof", LOCAL_USER_EMAIL: "developer@example.test",
      LOCAL_SESSION_TOKEN: session, PLATFORM_DEFAULT_TENANT_ID: tenantId,
      LOCAL_PUBLIC_ORIGIN: origin, PLATFORM_PUBLIC_ORIGIN: origin,
      DEVELOPER_MCP_ENABLED: "true", DEVELOPER_MCP_RESOURCE_URL: `${origin}/api/mcp/developer`,
      DEVELOPER_MCP_AUTHORIZATION_SERVER: `${origin}/`, SANDBOX_PROVIDER: "microsandbox",
      DEVELOPER_MCP_LOCAL_IMAGE: images.node, MSB_HOME: "/tmp/msb-route-proof",
      OPENTENANT_HOST_CANARY: canary, ROUTE_PROOF_HOST_PORT: String(listener.address().port),
      ROUTE_PROOF_PORT: String(port),
    };
    await writeFile(join(directory, "environment.json"), JSON.stringify(environment), { mode: 0o600 });
    child = spawn("docker", ["run", "--rm", "--init", "--pull=never", "--name", container.name,
      "--label", "opentenant.proof=developer-mcp-route", "--network", "host", "--device", "/dev/kvm",
      "--mount", `type=bind,src=${root},dst=/repo,readonly`, "--mount", `type=bind,src=${directory},dst=/proof`,
      "--tmpfs", "/repo/apps/platform/.next:rw", "--workdir", "/repo/apps/platform", images.node,
      "node", "/repo/tooling/proofs/developer-mcp-route.mjs", "--server"], { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", () => { logs += "Container launcher failed"; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { logs += data.toString(); });
    const deadline = Date.now() + 120_000;
    while (true) {
      if (child.exitCode !== null || Date.now() >= deadline) {
        throw new Error(`Real route startup failed; no proof was skipped. ${redacted(logs).replaceAll(session, "[redacted]").replaceAll(canary, "[redacted]").slice(-3500)}`);
      }
      try {
        const response = await fetch(`${origin}/api/mcp/developer?metadata`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200 || response.status === 405 && response.headers.get("allow") === "POST") break;
      } catch { /* Startup is bounded above; connection refusal is expected before listen. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return {
      origin, redirect, projectId, tenantId, clientId, session, pool,
      async counts() { return JSON.parse(await readFile(join(directory, "counts.json"), "utf8")); },
      diagnostics() { return redacted(logs).replaceAll(session, "[redacted]").replaceAll(canary, "[redacted]").slice(-4000); },
      async finish(counts, secrets, previewHtml) {
        const observed = JSON.parse(await readFile(join(directory, "counts.json"), "utf8"));
        check(observed.vm_created === 1 && observed.vm_destroyed === 1 && observed.route_commands === 1, "The actual route did not execute and destroy exactly one VM");
        for (const value of [session, canary, new URL(source).password, ...secrets]) {
          check(!logs.includes(value), "Secret appeared in route logs");
          check(!previewHtml.includes(value), "Secret appeared in the preview");
        }
        await dispose();
        const receipt = { ...observed, ...counts, log_secret_matches: 0, route_containers_remaining: 0, route_listener_ports_remaining: 0 };
        check(Object.values(receipt).every(value => Number.isSafeInteger(value) && value >= 0), "Receipt must contain counts only");
        await writeFile(routeReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
      },
      dispose,
    };
  } catch (error) { await dispose(); throw error; }
}

/** Shared browser journey, run by both the focused proof and the normal E2E spec. */
export async function runDeveloperRouteBrowserProof(page) {
  const { expect } = e2eRequire("@playwright/test");
  const proof = await startDeveloperRouteProof();
  const { origin, projectId, clientId, redirect, tenantId, pool } = proof;
  const resource = `${origin}/api/mcp/developer`;
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ project_id: projectId, client_id: clientId, redirect_uri: redirect,
    resource, response_type: "code", state: "route-proof", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const args = { templateId: "opentenant/module-service@1", label: "Route proof" };
  const counts = { oauth_consent: 0, pkce_exchanged: 0, pkce_wrong_denied: 0, oauth_replay_denied: 0,
    tenant_authorized: 0, tenant_denied: 0, confirmation_required: 0, confirmation_expired_denied: 0,
    human_confirmed: 0, confirmation_replay_denied: 0, revoked_denied: 0, token_expired_denied: 0,
    kill_switch_denied: 0, admission_denied: 0, preview_consumed: 0, preview_replay_denied: 0,
    preview_expired_denied: 0, preview_secret_matches: 0 };
  // Never put opaque credentials into assertion diagnostics or receipt fields.
  const requireProof = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    await page.context().addCookies([{ name: "opentenant_session", value: proof.session, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${resource}/authorize?${params}`);
    await expect(page.getByRole("heading", { name: "Authorize Developer MCP" })).toBeVisible();
    requireProof(Number((await pool.query("select count(*) from developer_mcp.oauth_codes where project_id=$1", [projectId])).rows[0].count) === 0, "Consent issued authority before the human clicked");
    await page.getByRole("button", { name: "Authorize client" }).click();
    await expect(page).toHaveURL(/\/callback\?code=/u);
    const callback = new URL(page.url());
    requireProof(callback.searchParams.get("state") === "route-proof", "OAuth state binding failed");
    counts.oauth_consent++;
    const form = { grant_type: "authorization_code", code: callback.searchParams.get("code"), code_verifier: verifier,
      client_id: clientId, redirect_uri: redirect, resource };
    requireProof((await page.request.post(`${resource}/token`, { form: { ...form, code_verifier: "x".repeat(43) } })).status() === 400, "Wrong PKCE verifier was accepted");
    counts.pkce_wrong_denied++;
    const exchanged = await page.request.post(`${resource}/token`, { form });
    requireProof(exchanged.status() === 200, "PKCE exchange failed");
    const token = (await exchanged.json()).access_token;
    requireProof(/^[A-Za-z0-9_-]{43}$/u.test(token), "Opaque access token missing");
    counts.pkce_exchanged++;
    requireProof((await page.request.post(`${resource}/token`, { form })).status() === 400, "OAuth code was reusable");
    counts.oauth_replay_denied++;
    const call = (confirmation = undefined, method = "tools/call") => page.request.post(resource, { headers: {
      Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method, ...(method === "tools/call" ? { "Mcp-Name": "workspace.create" } : {}),
      "Idempotency-Key": randomBytes(16).toString("hex"), ...(confirmation ? { "x-mcp-confirmation": confirmation } : {}),
    }, data: { jsonrpc: "2.0", id: 1, method, params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} },
      ...(method === "tools/call" ? { name: "workspace.create", arguments: args } : {}) } } });
    requireProof((await call(undefined, "tools/list")).status() === 200, "Tenant-authorized route discovery failed"); counts.tenant_authorized++;
    requireProof((await call()).status() === 403, "Mutation ran without human confirmation"); counts.confirmation_required++;
    const confirm = async () => {
      await page.goto(`${resource}/confirm`);
      await page.getByLabel("Project ID").fill(projectId);
      await page.getByLabel("Workspace label").fill(args.label);
      await page.getByRole("button", { name: "Confirm creation" }).click();
      await expect(page.getByRole("heading", { name: "Creation confirmed" })).toBeVisible();
      const value = (await page.locator("output").textContent());
      requireProof(/^[A-Za-z0-9_-]{43}$/u.test(value), "Human confirmation missing"); return value;
    };
    const expired = await confirm();
    await pool.query("update developer_mcp.confirmations set expires_at=now()-interval '1 second' where project_id=$1", [projectId]);
    requireProof((await call(expired)).status() === 403, "Expired confirmation accepted"); counts.confirmation_expired_denied++;
    const digest = createHash("sha256").update(token).digest("hex");
    await pool.query("update developer_mcp.tokens set revoked=true where digest=$1", [digest]);
    requireProof((await call()).status() === 401, "Revoked token accepted"); counts.revoked_denied++;
    await pool.query("update developer_mcp.tokens set revoked=false,expires_at=now()-interval '1 second' where digest=$1", [digest]);
    requireProof((await call()).status() === 401, "Expired token accepted"); counts.token_expired_denied++;
    await pool.query("update developer_mcp.tokens set expires_at=now()+interval '5 minutes' where digest=$1", [digest]);
    await pool.query("update developer_mcp.projects set tenant_id=$2 where id=$1", [projectId, `${tenantId}_foreign`]);
    requireProof((await call()).status() === 401, "Cross-tenant token accepted"); counts.tenant_denied++;
    await pool.query("update developer_mcp.projects set tenant_id=$2 where id=$1", [projectId, tenantId]);
    for (const scope of ["installation", `tenant:${tenantId}`]) {
      await pool.query("update developer_mcp.switches set enabled=false where scope=$1", [scope]);
      try { requireProof((await call()).status() === 403, "Kill switch failed"); counts.kill_switch_denied++; }
      finally { await pool.query("update developer_mcp.switches set enabled=true where scope=$1", [scope]); }
    }
    // Exhaust the real fixed window, tolerating one minute boundary during the
    // browser journey. Every admitted request still lacks human confirmation.
    let admissionDenied = false;
    for (let index = 0; index < 21; index++) {
      const status = (await call()).status();
      if (status === 429) { admissionDenied = true; break; }
      requireProof(status === 403, "Unexpected admission window result");
    }
    requireProof(admissionDenied, "Admission bound was bypassed"); counts.admission_denied++;
    requireProof((await proof.counts()).vm_created === 0, "A negative request created a VM");
    // Advance only this synthetic principal's stored window, never the clock or
    // the route implementation. The next call has fresh admission and approval.
    await pool.query("delete from admission_windows where tenant_id=$1", [tenantId]);
    const confirmation = await confirm(); counts.human_confirmed++;
    const executed = await call(confirmation);
    if (executed.status() !== 200) {
      const failure = (await executed.json()).error?.code;
      const jobs = await pool.query("select status,count(*)::int as count from developer_mcp.jobs where project_id=$1 group by status", [projectId]);
      throw new Error(`Real microVM route execution failed: HTTP ${executed.status()}, ${/^[a-z_]+$/u.test(failure) ? failure : "unknown"}, jobs=${JSON.stringify(jobs.rows)}, ${JSON.stringify(await proof.counts())}. ${proof.diagnostics()}`);
    }
    const body = await executed.json();
    const output = JSON.parse(body.result.content[0].text);
    requireProof(output.static === true && output.previewPath === "/api/mcp/developer/preview", "Static preview contract failed");
    const observed = await proof.counts();
    requireProof(observed.vm_created === 1 && observed.vm_destroyed === 1 && observed.kvm_remaining === 0 && observed.vm_records_remaining === 0, "Preview was issued before complete VM destruction");
    requireProof((await call(confirmation)).status() === 403, "Confirmation was reusable"); counts.confirmation_replay_denied++;
    const previewHeaders = { Authorization: `Bearer ${token}`, Origin: origin, "x-mcp-preview": output.previewHandle };
    const openPreview = () => page.request.post(`${origin}${output.previewPath}`, { headers: previewHeaders });
    await pool.query("update developer_mcp.previews set expires_at=now()-interval '1 second' where job_id=$1", [output.workspaceId]);
    requireProof((await openPreview()).status() === 403, "Expired preview accepted"); counts.preview_expired_denied++;
    await pool.query("update developer_mcp.previews set expires_at=now()+interval '1 minute' where job_id=$1", [output.workspaceId]);
    // This browser-side MCP client translates its credential-free link into the
    // required POST exchange. Forward the real response, including its sandbox
    // CSP, so Chromium renders precisely the bytes served by the actual route.
    let previewHtml = "";
    await page.route(`${origin}/route-proof-preview`, async route => {
      const response = await openPreview();
      if (response.ok()) requireProof(response.headers()["content-security-policy"]?.includes("default-src 'none'; sandbox;") === true, "Preview sandbox CSP missing");
      previewHtml = await response.text();
      await route.fulfill({ response });
    });
    await page.setContent(`<a href="${origin}/route-proof-preview">Open preview</a>`);
    await page.getByRole("link", { name: "Open preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tenant module", exact: true })).toBeVisible();
    for (const secret of [token, confirmation, output.previewHandle, proof.session]) requireProof(!previewHtml.includes(secret), "Secret appeared in the preview");
    const renderedPreview = previewHtml;
    counts.preview_consumed++;
    requireProof((await page.goto(`${origin}/route-proof-preview`))?.status() === 403, "Preview was reusable"); counts.preview_replay_denied++;
    await proof.finish(counts, [token, confirmation, expired, output.previewHandle, form.code, verifier], renderedPreview);
  } finally { await proof.dispose(); }
}

function kvmDescriptors() {
  return readdirSync("/proc").filter(pid => /^\d+$/u.test(pid)).flatMap(pid => {
    try { return readdirSync(`/proc/${pid}/fd`).filter(fd => {
      try { return /(?:\/dev\/kvm|kvm-vm|kvm-vcpu)/u.test(readlinkSync(`/proc/${pid}/fd/${fd}`)); }
      catch { return false; } // The descriptor may close while enumerating it.
    }); } catch { return []; } // A process may exit while enumerating it.
  });
}

function observeNativeFailures(sdk) {
  const nativeFs = sdk.Sandbox.prototype.fs;
  sdk.Sandbox.prototype.fs = function() {
    const files = nativeFs.call(this);
    const write = files.write.bind(files);
    files.write = async (...args) => {
      try { return await write(...args); }
      catch (error) { console.error(`Guest file write failed: ${redacted(error.message)}`); throw error; }
    };
    return files;
  };
  const nativeBuilder = sdk.Sandbox.builder;
  sdk.Sandbox.builder = function(name) {
    const builder = nativeBuilder.call(this, name);
    const create = builder.create.bind(builder);
    builder.create = async () => {
      try { return await create(); }
      catch (error) { console.error(`Native VM boot failed: ${redacted(error.message)}`); throw error; }
    };
    return builder;
  };
}

async function probeGuestIsolation(adapter, runCommand, sandboxId) {
  // Use the same production command path as node --check, including env -i.
  const code = `const fs=require('fs'),net=require('net');
if(JSON.stringify(Object.keys(process.env).sort())!==JSON.stringify(['HOME','PATH']))process.exit(2);
if(fs.existsSync('/repo')||fs.existsSync('/proof')||fs.existsSync('/tmp/route-host-secret'))process.exit(3);
if(fs.readdirSync('/sys/class/net').some(n=>!['lo','dummy0'].includes(n)))process.exit(4);
const probe=port=>new Promise(resolve=>{const s=net.connect(port[1],port[0]);s.setTimeout(1000);s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));s.once('timeout',()=>{s.destroy();resolve(true)})});
Promise.all([probe(['127.0.0.1',${Number(process.env.ROUTE_PROOF_HOST_PORT)}]),probe(['1.1.1.1',443])]).then(results=>{if(!results.every(Boolean))process.exit(5);console.log('ISOLATION_PASSED')});`;
  const probe = await runCommand.call(adapter, { sandboxId: sandboxId, executable: "node", args: ["-e", code.replace(/\n/gu, "")], cwd: "tmp", timeoutMs: 5000, outputLimitBytes: 1024 });
  check(probe.exitCode === 0 && probe.stdout === "ISOLATION_PASSED\n" && probe.stderr === "", "Same-VM isolation probes failed");
}

async function observeRouteAdapter(sdk, counts, save) {
  // Instrument only this disposable process. Every operation still delegates to
  // the real production adapter and native microsandbox SDK, with no fake output.
  const { MicrosandboxAdapter } = await import(platformRequire.resolve("@opentenant/sandbox/providers/microsandbox"));
  const create = MicrosandboxAdapter.prototype.create;
  const runCommand = MicrosandboxAdapter.prototype.runCommand;
  const terminate = MicrosandboxAdapter.prototype.terminate;
  MicrosandboxAdapter.prototype.create = async function(request) {
    counts.vm_create_attempts++; await save();
    let workspace;
    try { workspace = await create.call(this, request); }
    catch (error) { console.error(`Real adapter create failed: ${redacted(error.message)}`); throw error; }
    counts.vm_created++;
    check(kvmDescriptors().length > 0, "No live KVM VM descriptor"); counts.kvm_live++;
    check(request.network.mode === "deny_all" && request.network.allowedHosts.length === 0, "Route egress policy is not deny-all");
    try {
      await probeGuestIsolation(this, runCommand, workspace.id);
      counts.guest_environment_checks++; counts.guest_mount_checks++; counts.egress_host_denied++; counts.egress_public_denied++;
      await save(); return workspace;
    } catch (error) { await this.terminate(workspace.id); throw error; }
  };
  MicrosandboxAdapter.prototype.runCommand = async function(request) {
    let result;
    try { result = await runCommand.call(this, request); }
    catch (error) { console.error(`Route command operation failed: ${redacted(error.message)}`); throw error; }
    if (result.exitCode !== 0) console.error(`Route command failed: exit ${result.exitCode}, ${redacted(result.stderr)}`);
    if (request.executable === "mkdir") {
      check(JSON.stringify(request.args) === '["-p","/workspace"]' && result.exitCode === 0, "Workspace initialization failed");
      counts.workspace_initializations++; await save(); return result;
    }
    check(request.executable === "node" && JSON.stringify(request.args) === '["--check","module.mjs"]' && result.exitCode === 0, "Actual route command failed");
    counts.route_commands++; await save(); return result;
  };
  const destroyed = new Set();
  MicrosandboxAdapter.prototype.terminate = async function(id) {
    await terminate.call(this, id);
    if (!destroyed.has(id)) { destroyed.add(id); counts.vm_destroyed++; }
    counts.vm_records_remaining = (await sdk.Sandbox.list()).sandboxes.length;
    counts.kvm_remaining = kvmDescriptors().length;
    check(counts.vm_records_remaining === 0 && counts.kvm_remaining === 0, "VM remains after route teardown");
    await save();
  };
}

async function routeServer() {
  Object.assign(process.env, JSON.parse(await readFile("/proof/environment.json", "utf8")));
  const sdk = await import(sandboxRequire.resolve("microsandbox"));
  sdk.setDefaultBackend("local");
  const expected = JSON.parse(await readFile("/proof/image.json", "utf8"));
  await sdk.Image.load("/proof/image.tar", { tag: images.node });
  const image = await sdk.Image.inspect(images.node);
  // docker save can rewrite manifest encoding. Verify the pinned config and every
  // uncompressed layer digest, rather than trusting the extra local reference.
  check(image.config.digest === expected.config, "Cached image config differs from the Docker pin");
  assert.deepEqual(image.layers.map(layer => layer.diffId), expected.layers);
  const counts = { image_pins_verified: 1, workspace_initializations: 0, vm_create_attempts: 0, vm_created: 0, vm_destroyed: 0, route_commands: 0, kvm_live: 0,
    kvm_remaining: 0, vm_records_remaining: 0, guest_environment_checks: 0, guest_mount_checks: 0,
    egress_host_denied: 0, egress_public_denied: 0 };
  const save = () => writeFile("/proof/counts.json", JSON.stringify(counts));
  observeNativeFailures(sdk);
  check((await sdk.Sandbox.list()).sandboxes.length === 0 && kvmDescriptors().length === 0, "Proof runtime is not empty");
  await observeRouteAdapter(sdk, counts, save);
  await writeFile("/tmp/route-host-secret", process.env.OPENTENANT_HOST_CANARY, { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(process.env.ROUTE_PROOF_HOST_PORT) });
    socket.once("error", reject); socket.once("connect", () => { socket.destroy(); resolve(); });
  });
  await save();
  // Use Next's own TypeScript config loader, as the normal E2E server does.
  const { PHASE_DEVELOPMENT_SERVER } = platformRequire("next/constants");
  const configuration = await platformRequire("next/dist/server/config").default(PHASE_DEVELOPMENT_SERVER, join(root, "apps/platform"));
  const { default: next } = await import(platformRequire.resolve("next"));
  const app = next({ dev: true, conf: configuration, dir: join(root, "apps/platform"), hostname: "localhost", port: Number(process.env.ROUTE_PROOF_PORT) });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  await new Promise(resolve => server.listen(Number(process.env.ROUTE_PROOF_PORT), "127.0.0.1", resolve));
  const stop = async () => {
    server.closeAllConnections(); server.close(); await app.close(); process.exit(0);
  };
  process.once("SIGTERM", () => { void stop(); }); process.once("SIGINT", () => { void stop(); });
}

async function main() {
  await rm(routeReceipt, { force: true });
  if (!process.env.ADMIN_DATABASE_URL) {
    execFileSync("pnpm", ["db:ephemeral", "--", "node", fileURLToPath(import.meta.url)], {
      cwd: root, env: { ...process.env, pnpm_config_verify_deps_before_run: "false", npm_config_offline: "true" },
      stdio: "inherit", timeout: 600_000,
    });
    return;
  }
  const { Pool } = platformRequire("pg");
  const source = new URL(process.env.ADMIN_DATABASE_URL);
  check(["127.0.0.1", "localhost"].includes(source.hostname) && source.port !== "5432", "Use the canonical disposable loopback database");
  const admin = new Pool({ connectionString: source.href });
  const name = `opentenant_it_route_${randomBytes(8).toString("hex")}`;
  await admin.query(`create database ${name}`); await admin.end();
  source.pathname = `/${name}`;
  const pool = new Pool({ connectionString: source.href });
  const { applyMigrations } = await import(platformRequire.resolve("@opentenant/migrations"));
  const { loadControlPlaneMigrations } = await import(platformRequire.resolve("@opentenant/migrations/control-plane"));
  try {
    await applyMigrations(pool, await loadControlPlaneMigrations());
    await pool.query("insert into developer_mcp.switches values('installation',true)");
  } finally { await pool.end(); }
  const directory = await mkdtemp(join(tmpdir(), "opentenant-route-playwright-"));
  try {
    const config = { testDir: directory, testMatch: "route.spec.mjs",
      workers: 1, retries: 0, timeout: 240_000, use: { headless: true, trace: "off", screenshot: "off" },
      reporter: [["list"], ["json", { outputFile: join(directory, "results.json") }]] };
    await writeFile(join(directory, "playwright.config.mjs"), `export default ${JSON.stringify(config)};\n`);
    await writeFile(join(directory, "route.spec.mjs"), `import playwright from ${JSON.stringify(e2eRequire.resolve("@playwright/test"))};
const { test } = playwright;
import { runDeveloperRouteBrowserProof } from ${JSON.stringify(import.meta.url)};
test("callable route executes in real microVM and destroys it before preview", async ({ page }) => { await runDeveloperRouteBrowserProof(page); });\n`);
    execFileSync(process.execPath, [e2eRequire.resolve("@playwright/test/cli"), "test", "--config", join(directory, "playwright.config.mjs"), "--grep", "callable route executes in real microVM"], {
      cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        CONTROL_PLANE_DATABASE_URL: source.href, CI: "1", E2E_PHASE: "journeys" },
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 300_000,
    });
    const report = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
    check(report.stats.expected === 1 && report.stats.unexpected === 0 && report.stats.skipped === 0, "Browser route proof did not pass without skips");
  } catch (error) {
    console.error(redacted(error.stdout ?? error.message).slice(-6000));
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
  const receipt = JSON.parse(await readFile(routeReceipt, "utf8"));
  check(receipt.vm_created === 1 && receipt.vm_destroyed === 1 && receipt.preview_consumed === 1 && receipt.preview_replay_denied === 1, "Real route receipt is incomplete");
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await (process.argv.includes("--server") ? routeServer() : main()); }
  catch (error) { console.error(redacted(error.message).slice(0, 3500)); console.error("Developer MCP real route proof failed. No successful receipt was issued."); process.exitCode = 1; }
}
