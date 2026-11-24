import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { request } from "@playwright/test";
import { startModuleStub } from "./upstream.mjs";
import { ownerToken } from "./tenants.mjs";

const root = resolve(import.meta.dirname, "../..");

function provisionFixtures(env: NodeJS.ProcessEnv) {
  try {
    execFileSync(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "tooling/e2e/provision-fixtures.mjs"], { cwd: root, env: { ...env, IDENTITY_PROVIDER: "better-auth" }, stdio: "pipe" });
  } catch (error) {
    let diagnostic = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "Fixture process failed";
    for (const [key, value] of Object.entries(env)) {
      if (value && /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/u.test(key)) diagnostic = diagnostic.replaceAll(value, "[redacted]");
    }
    console.error(diagnostic.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gu, "[database URL redacted]").slice(-8000));
    throw error;
  }
}

export default async function setup() {
  const env = process.env;
  const controlUrl = new URL(env.CONTROL_PLANE_DATABASE_URL!);
  const adminUrl = new URL("/postgres", controlUrl);
  const pools: Pool[] = [];
  const pool = (url: URL) => {
    const value = new Pool({ connectionString: url.href, connectionTimeoutMillis: 1000 });
    pools.push(value);
    return value;
  };
  const admin = pool(adminUrl);
  const databaseNames = [controlUrl.pathname.slice(1)];
  let upstream: Awaited<ReturnType<typeof startModuleStub>> | undefined;
  const cleanup = async () => {
    await upstream?.dispose();
    await Promise.all(pools.filter((value) => value !== admin).map((value) => value.end()));
    await admin.end();
  };

  let stage = "Postgres startup";
  try {
    for (let attempt = 0; ; attempt++) {
      try { await admin.query("select 1"); break; }
      catch { if (attempt === 59) throw new Error("E2E PostgreSQL did not become ready"); }
      await setTimeout(500);
    }
    const version = await admin.query<{ server_version_num: string }>("show server_version_num");
    if (!version.rows[0]?.server_version_num.startsWith("17")) throw new Error("E2E requires PostgreSQL 17");
    for (const name of databaseNames) {
      if (!/^opentenant_it_e2e_[a-z0-9_]+$/u.test(name)) throw new Error("Unsafe E2E database name");
      await admin.query(`create database "${name}"`);
    }
    stage = "production provisioning and owner bootstrap";
    provisionFixtures(env);
    stage = "local TLS stub";
    upstream = await startModuleStub(env.E2E_DIRECTORY!, Number(env.E2E_UPSTREAM_PORT));
    // Compile the local auth redirect chain before browser clicks. Next dev
    // otherwise reloads its client while the first sign-in is in flight.
    stage = "local auth readiness";
    const token = env.E2E_PHASE === "legacy" ? env.LOCAL_SESSION_TOKEN! : ownerToken("workspace");
    const warmup = await request.newContext({ baseURL: env.LOCAL_PUBLIC_ORIGIN!, extraHTTPHeaders: { cookie: `opentenant_session=${token}` } });
    try {
      const response = await warmup.get("/auth/login?return=/", { timeout: 120_000 });
      if (!response.ok()) throw new Error("Local auth readiness failed");
      // Compile the large native client before starting browser test deadlines.
      // These unauthenticated GETs still enforce the real identity gates.
      for (const path of ["/assessment", "/support", "/settings/members", "/admin/tenants/new", "/admin/support"]) {
        const route = await warmup.get(path, { timeout: 180_000 });
        if (!route.ok()) throw new Error(`E2E route readiness failed: ${path}`);
      }
    } finally { await warmup.dispose(); }
    console.log("E2E: PostgreSQL 17 migrated; four provisioned tenants, core/Brain/Support schemas, DNS control, and HTTPS stub ready.");
    return cleanup;
  } catch (error) {
    await cleanup();
    const code = error && typeof error === "object" && "code" in error && /^[A-Z0-9_]+$/u.test(String(error.code)) ? String(error.code) : "unknown";
    // Database errors and subprocess buffers can contain ephemeral credentials.
    // eslint-disable-next-line preserve-caught-error -- Driver errors can embed database credentials in their cause.
    throw new Error(`E2E global setup failed; runner will clean local resources. Stage: ${stage}; code: ${code}.`);
  }
}
