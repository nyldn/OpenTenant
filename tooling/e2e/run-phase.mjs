import { startMailpit, verifyPostgresImage } from "../uat/mailpit.mjs";
import { tenants, ownerToken } from "./tenants.mjs";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupServiceDatabases } from "./service-cleanup.mjs";
import { startEphemeralPostgres } from "../db-ephemeral/postgres.mjs";
import { freePort, hostEnvironment, postgresPort } from "./safety.mjs";

if (process.argv.slice(2).includes("--list")) {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--pass-with-no-tests", ...process.argv.slice(2)], {
    cwd: import.meta.dirname, stdio: "inherit",
    env: { ...process.env, E2E_APP_PORT: "39999", LOCAL_PUBLIC_ORIGIN: "http://localhost:39999" },
  });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  process.exit(code ?? 1);
}

if (process.versions.node.split(".")[0] !== "22") throw new Error("E2E requires Node 22");
const directory = await mkdtemp(join(tmpdir(), "opentenant-e2e-"));
const tag = randomBytes(6).toString("hex");
const container = `opentenant-e2e-${tag}`;
const service = process.env.E2E_USE_POSTGRES_SERVICE === "1";
if (service && !process.env.E2E_POSTGRES_PORT) throw new Error("Service mode requires E2E_POSTGRES_PORT");
if (!service) verifyPostgresImage();
const database = service ? undefined : await startEphemeralPostgres();
const port = database?.port ?? await postgresPort(process.env.E2E_POSTGRES_PORT);
const appPort = await freePort();
const password = database ? decodeURIComponent(new URL(database.adminUrl).password) : process.env.E2E_SERVICE_PASSWORD;
if (!password) throw new Error("Service mode requires E2E_SERVICE_PASSWORD");
const privateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const env = {
  ...hostEnvironment(process.env),
  pnpm_config_verify_deps_before_run: "false",
  npm_config_offline: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  TURBO_TELEMETRY_DISABLED: "1",
  E2E_PHASE: process.env.E2E_PHASE,
  E2E_FILTERED: process.env.E2E_FILTERED,
  DEVELOPER_MCP_ENABLED: "true",
  DEVELOPER_MCP_RESOURCE_URL: `http://localhost:${appPort}/api/mcp/developer`,
  DEVELOPER_MCP_AUTHORIZATION_SERVER: `http://localhost:${appPort}/`,
  IDENTITY_PROVIDER: process.env.E2E_PHASE === "legacy" ? "local" : "better-auth",
  LOCAL_USER_ID: "user_e2e",
  LOCAL_USER_EMAIL: "admin@example.test",
  LOCAL_USER_NAME: "Example Admin",
  LOCAL_SESSION_TOKEN: randomBytes(32).toString("hex"),
  PROVISIONING_PROVIDER: "postgres",
  POSTGRES_ADMIN_DATABASE_URL: database?.adminUrl ?? `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`,
  POSTGRES_TENANT_REGION: "synthetic-eu",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  BETTER_AUTH_BASE_URL: `http://localhost:${appPort}`,
  TENANT_OWNER_INVITE_DIRECTORY: join(directory, "invites"),
  OPENTENANT_E2E: "1",
  LOCAL_PUBLIC_ORIGIN: `http://localhost:${appPort}`,
  PLATFORM_PUBLIC_ORIGIN: `http://localhost:${appPort}`,
  PLATFORM_DEFAULT_TENANT_ID: "tenant_e2e",
  PLATFORM_DEV_HOST_SUFFIXES: "",
  LOCAL_TENANT_ID: "tenant_e2e",
  MODULE_ACCESS_SECRET: randomBytes(32).toString("hex"),
  MODULE_SIGNING_PRIVATE_KEY: String(privateKey),
  MODULE_REMOTE_HOST_ALLOWLIST: "module.example.test",
  TENANT_DB_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CONTROL_PLANE_DATABASE_URL: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/opentenant_it_e2e_${tag}`,
  E2E_POSTGRES_PORT: String(port),
  E2E_USE_POSTGRES_SERVICE: "1",
  E2E_CONTAINER: container,
  E2E_PASSWORD: password,
  E2E_DIRECTORY: directory,
  E2E_APP_PORT: String(appPort),
  E2E_UPSTREAM_PORT: String(await freePort()),
  E2E_DNS_PORT: String(await freePort()),
};
process.env.LOCAL_SESSION_TOKEN = env.LOCAL_SESSION_TOKEN;
process.env.E2E_PHASE = env.E2E_PHASE;
if (env.E2E_PHASE === "legacy") {
  env.LOCAL_USERS = JSON.stringify([{ token: env.LOCAL_SESSION_TOKEN, tenant: "tenant_e2e", user: "user_e2e", email: "admin@example.test", name: "Example Admin", role: "tenant_owner" }, ...tenants.map(tenant => ({ token: ownerToken(tenant.slug), tenant: tenant.tenantId, user: `user_e2e_${tenant.slug}`, email: `${tenant.slug}@example.test`, name: `${tenant.displayName} Owner`, role: "tenant_owner" }))]);
}

let mail;
let child;
const forward = (signal) => {
  if (child?.pid) process.kill(-child.pid, signal);
};
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
try {
  mail = await startMailpit({ name: `opentenant-e2e-mail-${tag}`, labels: { "opentenant.e2e.run": tag } });
  Object.assign(env, { IDENTITY_SMTP_HOST: "127.0.0.1", IDENTITY_SMTP_PORT: String(mail.smtpPort), IDENTITY_SMTP_FROM: "noreply@example.test", MAILPIT_HTTP_URL: mail.url });
  child = spawn("pnpm", ["exec", "playwright", "test", "--pass-with-no-tests", ...process.argv.slice(2)], {
    cwd: import.meta.dirname, env, stdio: "inherit", detached: true,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  // Playwright stops webServer before exiting. Only then remove its database,
  // so app pools never log forced-disconnect errors or credential-bearing clients.
  try {
    if (database) {
      await database.dispose();
    } else {
      await cleanupServiceDatabases(env.CONTROL_PLANE_DATABASE_URL);
    }
  } catch {
    console.error("E2E database cleanup failed; inspect the run-owned local resources.");
    process.exitCode = 1;
  } finally {
    await mail?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
