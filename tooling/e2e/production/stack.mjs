import { spawn } from "node:child_process";
import { randomBytes, generateKeyPairSync, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { startEphemeralPostgres } from "../../db-ephemeral/postgres.mjs";
import { freePort, hostEnvironment } from "../safety.mjs";
import { startMailpit, captureMailSeed, verifyPostgresImage } from "../../uat/mailpit.mjs";
import { fixtureSnapshot } from "../../uat/snapshot.mjs";
import { childProcess, gateway, manifestFor, resources, waitFor } from "../../uat/runtime.mjs";

// Same canonical UAT seeding, snapshot, gateway and teardown, with a production
// environment: optional MCP off, no local-fetch preload or dev DNS adapter.
const root = resolve(import.meta.dirname, "../../..");
const state = join(root, ".uat"), runId = randomBytes(12).toString("hex");
const owned = resources(), controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 required");
  await mkdir(state, { recursive: true, mode: 0o700 }); await mkdir(join(state, "active"));
  owned.add(() => rm(join(state, "active"), { recursive: true, force: true }));
  const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
  await writeFile(join(state, "active/owner.json"), JSON.stringify({ pid: process.pid, stamp: stat.split(") ")[1].split(" ")[19] }), { mode: 0o600 });
  const directory = await mkdtemp(join(tmpdir(), "opentenant-production-"));
  owned.add(() => rm(directory, { recursive: true, force: true }));
  const guardian = spawn(process.execPath, [join(root, "tooling/uat/guardian.mjs"), `opentenant.uat.run=${runId}`], { stdio: ["pipe", "ignore", "inherit"], env: hostEnvironment(process.env) });
  owned.add(async () => { guardian.stdin.end(); await new Promise(resolve => guardian.once("exit", resolve)); });
  const ledger = guardian.stdin;
  const appPort = await freePort(), nextPort = await freePort();
  verifyPostgresImage();
  const labels = { "opentenant.uat": "true", "opentenant.uat.run": runId, "opentenant.uat.workspace": createHash("sha256").update(root).digest("hex").slice(0,20) };
  const database = await startEphemeralPostgres({ labels }); owned.add(() => database.dispose());
  const mail = await startMailpit({ name: `opentenant-production-mail-${runId}`, labels, signal: controller.signal }); owned.add(() => mail.dispose());
  const env = {
    ...hostEnvironment(process.env), NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1",
    npm_config_offline: "true", pnpm_config_verify_deps_before_run: "false", DEVELOPER_MCP_ENABLED: "false",
    IDENTITY_PROVIDER: "better-auth", PROVISIONING_PROVIDER: "postgres", POSTGRES_ADMIN_DATABASE_URL: database.adminUrl,
    POSTGRES_TENANT_REGION: "synthetic-eu", CONTROL_PLANE_DATABASE_URL: new URL(new URL(database.appUrl).pathname, database.adminUrl).href,
    OPENTENANT_TENANT_BASE_DOMAIN: "localhost", PLATFORM_ADMIN_HOST: "admin.localhost", PLATFORM_DEV_HOST_SUFFIXES: "",
    PLATFORM_PUBLIC_ORIGIN: `http://localhost:${appPort}`, LOCAL_PUBLIC_ORIGIN: `http://localhost:${appPort}`,
    BETTER_AUTH_BASE_URL: `http://localhost:${appPort}`, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    MODULE_REMOTE_HOST_ALLOWLIST: "module.example.test", MODULE_SIGNING_PRIVATE_KEY: String(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" })),
    MODULE_ACCESS_SECRET: randomBytes(32).toString("hex"), CONNECTIONS_STATE_SECRET: randomBytes(32).toString("hex"), TENANT_DB_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TENANT_OWNER_INVITE_DIRECTORY: join(directory, "invites"), TENANT_EXPORT_DIRECTORY: join(directory, "exports"),
    IDENTITY_SMTP_HOST: "127.0.0.1", IDENTITY_SMTP_PORT: String(mail.smtpPort), IDENTITY_SMTP_FROM: "noreply@example.test",
    E2E_DIRECTORY: directory, E2E_PASSWORD: randomBytes(24).toString("hex"), E2E_APP_PORT: String(appPort), E2E_HOST_SUFFIX: "localhost",
  };
  await writeFile(join(state, "active/fixture.json"), JSON.stringify({ controlUrl: env.CONTROL_PLANE_DATABASE_URL, servicePostgres: false }), { mode: 0o600 });
  const seed = childProcess(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "tooling/uat/seed.mjs"], { cwd: root, env, ledger }); owned.add(() => seed.dispose());
  if (await seed.exited !== 0) throw new Error("Production fixture seed failed");
  controller.signal.throwIfAborted();
  const { users, tenants, documents } = JSON.parse(await readFile(join(directory, "uat-seed.json"), "utf8"));
  const mailSeed = await captureMailSeed(mail, directory);
  const appEnv = { ...env, NODE_ENV: "production", BETTER_AUTH_BASE_URL: `https://localhost:${appPort}` };
  for (const key of Object.keys(appEnv)) if (key.startsWith("E2E_")) delete appEnv[key];
  const require = createRequire(new URL("../package.json", import.meta.url));
  const next = require.resolve("next/dist/bin/next");
  if (process.argv.includes("--build")) {
    const build = childProcess(process.execPath, [next, "build"], { cwd: join(root, "apps/platform"), env: appEnv, ledger }); owned.add(() => build.dispose());
    if (await build.exited !== 0) throw new Error("Production build failed");
  }
  const startApp = () => childProcess(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: join(root, "apps/platform"), env: appEnv, ledger });
  const startWorker = () => childProcess(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "apps/platform/workflows/worker.ts"], { cwd: root, env, ledger });
  let app = startApp(), worker = startWorker();
  owned.add(() => app.dispose()); owned.add(() => worker.dispose());
  await waitFor(`http://127.0.0.1:${nextPort}/opentenant-logo.svg`, controller.signal);
  const snapshot = await fixtureSnapshot({ container: database.containerName, directory });
  let revision = 0, resetting = false;
  const manifest = manifestFor({ runId, appPort, nextPort, mailPort: mail.mailPort, smtpPort: mail.smtpPort, postgresPort: database.port, users, tenants, mode: "start" });
  const reset = async () => {
    if (resetting || controller.signal.aborted) throw new Error("Production reset unavailable");
    resetting = true;
    try {
      await worker.dispose(); await app.dispose(); await snapshot.restore(); await mailSeed.restore();
      const verified = await snapshot.verify(); app = startApp(); worker = startWorker();
      await waitFor(`http://127.0.0.1:${nextPort}/opentenant-logo.svg`, controller.signal);
      manifest.fixtureRevision = ++revision;
      await writeFile(join(state, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
      return { version: 1, reset: "seed", revision, verified };
    } finally { resetting = false; }
  };
  const stopToken = randomBytes(32).toString("hex");
  const front = gateway({ appPort, nextPort, users, tenants, documents, mode: "start", stopToken, stop, reset, revision: () => `${runId}:${revision}` });
  await new Promise((resolve, reject) => { front.server.once("error", reject); front.server.listen(appPort, "127.0.0.1", resolve); }); owned.add(() => front.dispose());
  await writeFile(join(state, "active/control.json"), JSON.stringify({ appPort, stopToken }), { mode: 0o600 });
  await writeFile(join(state, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 }); owned.add(() => rm(join(state, "manifest.json"), { force: true }));
  console.log("Production fixture ready: MCP disabled; dev fetch/DNS injection absent; Better Auth production guards intact.");
  if (!controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener("abort", resolve, { once: true }));
} catch {
  console.error("Production fixture failed. Inspect the private stack log."); process.exitCode = 1;
} finally { await owned.dispose(); }
