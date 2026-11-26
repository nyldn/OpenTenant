import { spawn } from "node:child_process";
import { randomBytes, createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { startEphemeralPostgres } from "../db-ephemeral/postgres.mjs";
import { freePort, hostEnvironment } from "../e2e/safety.mjs";
import { startModuleStub } from "../e2e/upstream.mjs";
import { dnsControl } from "../e2e/dns-control.mjs";
import { startServicePostgres } from "./service-postgres.mjs";
import { startMailpit, captureMailSeed, prepareDemoImages, verifyPostgresImage } from "./mailpit.mjs";
import { processTreeRss } from "./metrics.mjs";
import { fixtureSnapshot } from "./snapshot.mjs";
import { runOperatorControl } from "./operator.mjs";
import { resetControlState } from "./provision-control.mjs";
import { childProcess, gateway, manifestFor, resources, waitFor } from "./runtime.mjs";

const root = resolve(import.meta.dirname, "../..");
const state = join(root, ".uat");
const platformDirectory = join(root, "apps/platform");
const workspaceLabel = `opentenant.uat.workspace=${createHash("sha256").update(root).digest("hex").slice(0, 20)}`;
const runId = randomBytes(12).toString("hex");
const owned = resources();
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
let stage = "configuration";
let failureHint = "Inspect the local service log for details.";
try {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 required");
  const flags = process.argv.slice(2).filter(a => a !== "--");
  const demo = flags.length === 1 && flags[0] === "--demo";
  if (!demo && flags.some(flag => !["--start", "--build", "--better-auth", "--audit"].includes(flag))) {
    throw new Error("Usage: pnpm uat:serve [--start] [--build] [--better-auth] or pnpm local:demo");
  }
  if (demo && [".env", ".env.local", ".env.development", ".env.development.local"].some(
    name => existsSync(join(platformDirectory, name)),
  )) {
    failureHint = "Run pnpm local:demo from a checkout without app dotenv files.";
    throw new Error("Next.js would load local platform configuration");
  }
  const mode = flags.includes("--start") ? "start" : "dev";
  const identityProvider = demo || mode === "start" || flags.includes("--better-auth") ? "better-auth" : "local";
  if (flags.includes("--build") && mode !== "start") throw new Error("--build requires --start");
  await mkdir(state, { recursive: true, mode: 0o700 });
  // An atomic lock prevents two launchers overwriting the same manifest.
  await mkdir(join(state, "active"));
  owned.add(() => rm(join(state, "active"), { recursive: true, force: true }));
  const parentStat = process.platform === "linux" ? await readFile(`/proc/${process.pid}/stat`, "utf8") : undefined;
  await writeFile(join(state, "active", "owner.json"), JSON.stringify({ worktree: root, runId, pid: process.pid, stamp: parentStat?.split(") ")[1].split(" ")[19] }), { mode: 0o600 });
  const directory = await mkdtemp(join(tmpdir(), "opentenant-uat-"));
  owned.add(() => rm(directory, { recursive: true, force: true }));
  const guardian = spawn(process.execPath, [join(import.meta.dirname, "guardian.mjs"), `opentenant.uat.run=${runId}`], { stdio: ["pipe", "ignore", "inherit"], env: hostEnvironment(process.env) });
  await new Promise((resolve, reject) => { guardian.once("spawn", resolve); guardian.once("error", reject); });
  owned.add(async () => { guardian.stdin.end(); await new Promise(resolve => guardian.once("exit", resolve)); });
  const ledger = guardian.stdin;
  if (demo) {
    stage = "pinned demo images";
    await prepareDemoImages(controller.signal);
  }
  controller.signal.throwIfAborted();
  const appPort = await freePort();
  const nextPort = await freePort();
  const dnsPort = await freePort();
  const upstreamPort = await freePort();
  const stopToken = randomBytes(32).toString("hex");
  stage = "Postgres";
  const servicePostgres = flags.includes("--audit") && process.env.E2E_USE_POSTGRES_SERVICE === "1";
  if (!servicePostgres) verifyPostgresImage();
  const database = servicePostgres ? await startServicePostgres(runId) : await startEphemeralPostgres({ labels: { "opentenant.uat": "true", "opentenant.uat.run": runId, [workspaceLabel.split("=")[0]]: workspaceLabel.split("=")[1] } });
  owned.add(() => database.dispose());
  controller.signal.throwIfAborted();
  stage = "Mailpit";
  const mail = await startMailpit({ name: `opentenant-uat-mail-${runId}`, labels: { "opentenant.uat": "true", "opentenant.uat.run": runId, [workspaceLabel.split("=")[0]]: workspaceLabel.split("=")[1] }, signal: controller.signal });
  owned.add(() => mail.dispose());
  const { mailPort, smtpPort } = mail;
  const env = {
    ...hostEnvironment(process.env), NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1", npm_config_offline: "true", pnpm_config_verify_deps_before_run: "false",
    DEVELOPER_MCP_ENABLED: "true", DEVELOPER_MCP_RESOURCE_URL: `http://localhost:${appPort}/api/mcp/developer`, DEVELOPER_MCP_AUTHORIZATION_SERVER: `http://localhost:${appPort}/`,
    IDENTITY_PROVIDER: "better-auth", PROVISIONING_PROVIDER: "postgres", POSTGRES_ADMIN_DATABASE_URL: database.adminUrl,
    POSTGRES_TENANT_REGION: "synthetic-eu", CONTROL_PLANE_DATABASE_URL: new URL(new URL(database.appUrl).pathname, database.adminUrl).href,
    OPENTENANT_TENANT_BASE_DOMAIN: "localhost", PLATFORM_ADMIN_HOST: "admin.localhost", PLATFORM_DEV_HOST_SUFFIXES: "",
    PLATFORM_PUBLIC_ORIGIN: `http://localhost:${appPort}`, LOCAL_PUBLIC_ORIGIN: `http://localhost:${appPort}`,
    BETTER_AUTH_BASE_URL: `http://localhost:${appPort}`, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    MODULE_REMOTE_HOST_ALLOWLIST: "module.example.test", MODULE_SIGNING_PRIVATE_KEY: String(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" })),
    MODULE_ACCESS_SECRET: randomBytes(32).toString("hex"), CONNECTIONS_STATE_SECRET: randomBytes(32).toString("hex"), TENANT_DB_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TENANT_OWNER_INVITE_DIRECTORY: join(directory, "invites"), TENANT_EXPORT_DIRECTORY: join(directory, "exports"),
    IDENTITY_SMTP_HOST: "127.0.0.1", IDENTITY_SMTP_PORT: String(smtpPort), IDENTITY_SMTP_FROM: "noreply@example.test",
    E2E_DIRECTORY: directory, E2E_PASSWORD: randomBytes(24).toString("hex"), E2E_DNS_PORT: String(dnsPort), E2E_APP_PORT: String(appPort), E2E_HOST_SUFFIX: "localhost", E2E_UPSTREAM_PORT: String(upstreamPort),
  };
  await writeFile(join(state, "active", "fixture.json"), JSON.stringify({ controlUrl: env.CONTROL_PLANE_DATABASE_URL, servicePostgres }), { mode: 0o600 });
  stage = "canonical migrations and production worker provisioning";
  const seed = childProcess(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "tooling/uat/seed.mjs"], { cwd: root, env, ledger });
  owned.add(() => seed.dispose());
  const cancelSeed = () => { void seed.dispose(); };
  controller.signal.addEventListener("abort", cancelSeed, { once: true });
  if (await seed.exited !== 0) throw new Error("Seeding failed");
  controller.signal.removeEventListener("abort", cancelSeed);
  controller.signal.throwIfAborted();
  const { users, tenants, documents } = JSON.parse(await readFile(join(directory, "uat-seed.json"), "utf8"));
  const mailSeed = flags.includes("--audit") ? undefined : await captureMailSeed(mail, directory);
  let resetting = false;
  let controlling = false;
  const startWorker = () => childProcess(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "apps/platform/workflows/worker.ts"], { cwd: root, env, ledger });
  let worker = startWorker();
  owned.add(() => worker.dispose());
  void worker.exited.then(() => { if (!resetting && !controller.signal.aborted) { process.exitCode = 1; console.error("UAT worker exited unexpectedly."); stop(); } });
  const dns = dnsControl();
  await new Promise((resolve, reject) => { dns.once("error", reject); dns.listen(dnsPort, "127.0.0.1", resolve); });
  owned.add(() => new Promise(resolve => { dns.closeAllConnections(); dns.close(resolve); }));
  const upstream = await startModuleStub(directory, upstreamPort);
  owned.add(() => upstream.dispose());
  const require = createRequire(new URL("../e2e/package.json", import.meta.url));
  const nextBin = require.resolve("next/dist/bin/next");
  const appEnv = mode === "dev" ? { ...env, IDENTITY_PROVIDER: identityProvider, OPENTENANT_E2E: "1", ...(identityProvider === "local" ? { LOCAL_USERS: JSON.stringify(users), LOCAL_SESSION_TOKEN: users[0].token } : {}) } : { ...env, NODE_ENV: "production", BETTER_AUTH_BASE_URL: `https://localhost:${appPort}` };
  appEnv.NODE_OPTIONS = `--import=${JSON.stringify(join(root, "tooling/e2e/local-fetch.mjs"))}`;
  if (flags.includes("--build")) {
    stage = "Next build";
    const build = childProcess(process.execPath, [nextBin, "build"], { cwd: platformDirectory, env: appEnv, ledger });
    owned.add(() => build.dispose());
    const cancelBuild = () => { void build.dispose(); };
    controller.signal.addEventListener("abort", cancelBuild, { once: true });
    if (await build.exited !== 0) throw new Error("Build failed");
    controller.signal.removeEventListener("abort", cancelBuild);
  }
  controller.signal.throwIfAborted();
  stage = "Next startup";
  if (mode === "dev") await rm(join(platformDirectory, ".next"), { recursive: true, force: true });
  const startPlatform = () => childProcess(process.execPath, [nextBin, mode, "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: platformDirectory, env: appEnv, ledger });
  let platform = startPlatform();
  owned.add(() => platform.dispose());
  let peakRssBytes = 0;
  const sample = async () => { peakRssBytes = Math.max(peakRssBytes, await processTreeRss(platform.child.pid)); };
  const sampler = setInterval(() => { void sample(); }, 1000); sampler.unref();
  owned.add(async () => { clearInterval(sampler); await sample(); await writeFile(join(state, "last-metrics.json"), JSON.stringify({ peakRssBytes }), { mode: 0o600 }); });
  void platform.exited.then(() => { if (!resetting && !controller.signal.aborted) { process.exitCode = 1; console.error("UAT platform exited unexpectedly."); stop(); } });
  await waitFor(`http://127.0.0.1:${nextPort}/opentenant-logo.svg`, controller.signal, [200, 404]);
  const snapshot = flags.includes("--audit") ? undefined : await fixtureSnapshot({ container: database.containerName, directory });
  let revision = 0;
  const reset = async () => {
    if (!snapshot || resetting || controlling || controller.signal.aborted) throw new Error("Reset unavailable");
    resetting = true;
    let resetStage = "stop";
    try {
      await worker.dispose(); await platform.dispose();
      resetStage = "restore"; await snapshot.restore();
      resetStage = "mail"; await mailSeed.restore();
      resetStage = "verify"; const verified = await snapshot.verify();
      await resetControlState(root);
      if (mode === "dev") await rm(join(platformDirectory, ".next"), { recursive: true, force: true });
      resetStage = "restart"; platform = startPlatform(); worker = startWorker();
      for (const runtime of [platform, worker]) void runtime.exited.then(() => {
        if (!resetting && !controller.signal.aborted) { process.exitCode = 1; console.error("UAT runtime exited unexpectedly after reset."); stop(); }
      });
      await waitFor(`http://127.0.0.1:${nextPort}/opentenant-logo.svg`, controller.signal, [200, 404]);
      revision += 1;
      manifest.fixtureRevision = revision;
      await writeFile(join(state, "manifest.json"), JSON.stringify(manifest, null, 2)+"\n", { mode: 0o600 });
      return { version: 1, reset: "seed", revision, verified };
    } catch {
      console.error(`UAT reset failed during ${resetStage}; stack stopping.`);
      process.exitCode = 1; setTimeout(stop, 100); throw new Error("UAT reset failed; stack stopping");
    } finally { resetting = false; }
  };
  const operator = async input => {
    if (resetting || controlling || controller.signal.aborted) throw new Error("UAT control unavailable");
    controlling = true;
    try { return await runOperatorControl({ root, runId, database: { ...database, controlUrl: env.CONTROL_PLANE_DATABASE_URL } }, input); }
    finally { controlling = false; }
  };
  const front = gateway({ appPort, nextPort, users, tenants, documents, mode, identityProvider, demo, stopToken, stop, reset, operator, revision: () => `${runId}:${revision}` });
  await new Promise((resolve, reject) => { front.server.once("error", reject); front.server.listen(appPort, "127.0.0.1", resolve); });
  owned.add(() => front.dispose());
  const manifest = manifestFor({ runId, worktree: root, appPort, nextPort, mailPort, smtpPort, postgresPort: database.port, dnsPort, upstreamPort, users, tenants, mode, identityProvider });
  // Keep credentials in the private manifest; stdout contains only its path.
  await writeFile(join(state, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(state, "active", "control.json"), JSON.stringify({ worktree: root, runId, appPort, stopToken }), { mode: 0o600 });
  owned.add(() => rm(join(state, "manifest.json"), { force: true }));
  if (demo) {
    const owner = manifest.personas.find(persona => persona.id === "alpha-owner");
    if (!owner) throw new Error("Demo owner is unavailable");
    await writeFile(join(state, "active", "demo-url"), owner.signInUrl + "\n", { mode: 0o600 });
    console.log("Demo ready. Open the private URL in .uat/active/demo-url to try Support.");
    console.log("Save a sample ticket and reload to see it persist. Press Ctrl+C to stop.");
  }
  console.log(`UAT ready (${identityProvider}); private manifest: ${join(state, "manifest.json")}`);
  stage = "serving";
  if (!controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener("abort", resolve, { once: true }));
} catch (error) {
  if (!controller.signal.aborted) {
    // Do not expose driver errors or subprocess environments containing run credentials.
    console.error(`UAT failed during ${stage}. ${error.code === "EEXIST" ? "Run pnpm uat:down to clear the workspace lock." : failureHint}`);
    process.exitCode = 1;
  }
} finally {
  try { await owned.dispose(); } catch { console.error("UAT teardown failed; run pnpm uat:down."); process.exitCode = 1; }
}
