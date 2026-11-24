import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const project = `opentenant-smoke-${process.pid}-${randomBytes(4).toString("hex")}`;
const image = `${project}-app:smoke`;
const migrationImage = `${project}-migrate:smoke`;
const port = process.env.SMOKE_APP_PORT ?? "3300";
const pgPort = process.env.SMOKE_POSTGRES_PORT ?? "55435";
for (const value of [port, pgPort]) {
  assert.ok(/^\d+$/u.test(value) && Number(value) > 1024 && Number(value) < 65536, "Use non-default unprivileged host ports");
  assert.ok(!["3000", "5432"].includes(value), "Default app and database ports are forbidden");
}
const password = randomBytes(24).toString("hex");
const databaseUrl = `postgresql://opentenant:${password}@postgres:5432/opentenant`;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  OPENTENANT_IMAGE: image, OPENTENANT_MIGRATION_IMAGE: migrationImage,
  APP_PORT: port, POSTGRES_PORT: pgPort, POSTGRES_PASSWORD: password,
  CONTROL_PLANE_DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl,
  IDENTITY_PROVIDER: "workos", PLATFORM_PUBLIC_ORIGIN: `http://smoke.example.test:${port}`,
  PLATFORM_ADMIN_HOST: "admin.localhost",
  MODULE_ACCESS_SECRET: randomBytes(32).toString("hex"),
  CONNECTIONS_STATE_SECRET: randomBytes(32).toString("hex"),
  // Synthetic values satisfy production config validation. Anonymous probes
  // never call WorkOS or Neon, so none of these reach a provider.
  OPENTENANT_TENANT_BASE_DOMAIN: "example.test",
  TENANT_DB_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  PROVISIONING_PROVIDER: "postgres", POSTGRES_ADMIN_DATABASE_URL: `postgresql://opentenant:${password}@postgres:5432/postgres`, POSTGRES_TENANT_REGION: "synthetic-local",
  WORKOS_API_KEY: "sk_test_synthetic_smoke_unused", WORKOS_CLIENT_ID: "client_synthetic_smoke",
  WORKOS_COOKIE_PASSWORD: randomBytes(32).toString("hex"),
  WORKOS_REDIRECT_URI: "https://smoke.example.test/auth/callback",
  CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "", CLERK_JWT_ISSUER: "", CLERK_AUTHORIZED_PARTIES: "", CLERK_JWT_AUDIENCE: "",
};
const compose = ["compose", "--env-file", "/dev/null", "-f", "compose.production.yaml", "-p", project];
let activeChild;
let interrupted = false;

function run(args, { input, capture = false, duringCleanup = false } = {}) {
  if (interrupted && !duringCleanup) return Promise.reject(new Error("Smoke interrupted"));
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd, env, stdio: ["pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"] });
    activeChild = child;
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      // Runtime error output can contain credentials. Report only the exit code.
      child.stderr.resume();
    }
    child.on("error", () => reject(new Error("Docker could not start")));
    child.on("close", (code) => {
      activeChild = undefined;
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Docker command failed with exit ${code}; runtime details withheld`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function probe(host, path = "/") {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: Number(port), path, headers: { Host: `${host}:${port}` }, timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => reject(new Error("Local HTTP probe failed")));
    req.end();
  });
}

// All generated names belong to this run. Never prune shared Docker state.
let cleanup;
function clean() {
  cleanup ??= (async () => {
    await run([...compose, "down", "--volumes", "--remove-orphans"], { capture: true, duringCleanup: true });
    for (const tag of [image, migrationImage]) {
      const found = await run(["image", "ls", "--quiet", "--filter", `reference=${tag}`], { capture: true, duringCleanup: true });
      if (found) await run(["image", "rm", tag], { capture: true, duringCleanup: true });
    }
    console.log("Smoke cleanup: containers, network, database volume and tagged images removed.");
  })();
  return cleanup;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { interrupted = true; activeChild?.kill("SIGTERM"); });
}

try {
  console.log(`Smoke project: ${project}; loopback ports app=${port}, postgres=${pgPort}.`);
  await run(["build", `--network=${process.env.SMOKE_BUILD_NETWORK ?? "default"}`, "-f", "apps/platform/Dockerfile", "--target", "runner", "-t", image, "."]);
  await run(["build", `--network=${process.env.SMOKE_BUILD_NETWORK ?? "default"}`, "-f", "apps/platform/Dockerfile", "--target", "migrator", "-t", migrationImage, "."]);
  const user = await run(["image", "inspect", "--format", "{{.Config.User}}", image], { capture: true });
  assert.equal(user, "node", "App must run as the non-root node user");
  try {
    await run([...compose, "up", "-d", "--wait", "--wait-timeout", "120"], { capture: true });
  } catch {
    const statuses = await run([...compose, "ps", "--all", "--format", "{{.Service}} {{.State}} {{.ExitCode}}"], { capture: true });
    console.error(`Smoke startup status: ${statuses}`);
    // Config validation errors name the variable, never its value.
    const appLogs = await run([...compose, "logs", "--no-color", "app"], { capture: true }).catch(() => "");
    for (const line of appLogs.split("\n").filter((entry) => entry.includes("server configuration"))) console.error(line.trim());
    throw new Error("Stack startup failed");
  }
  const health = await probe("health.localhost", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).status, "ok");
  console.log("Smoke health: /api/health 200; migration completed before app startup; non-root image user verified.");
  // Synthetic fixtures only. Register a verified local hostname instead of
  // enabling a production default-tenant bypass or creating an admin user.
  await run([...compose, "exec", "-T", "postgres", "psql", "-U", "opentenant", "-d", "opentenant", "-v", "ON_ERROR_STOP=1"], { capture: true, input: `
    INSERT INTO tenants (tenant_id, slug, display_name, status, data_region)
      VALUES ('tenant_smoke', 'smoke', 'Example Organisation', 'active', 'eu');
    INSERT INTO domains (tenant_id, host, kind, verification, active)
      VALUES ('tenant_smoke', 'smoke.example.test', 'opentenant_subdomain', 'verified', true);
  ` });
  // Production resolves only platform subdomains under the configured base
  // domain (or verified custom domains), so register one under example.test.
  const tenantProbe = await probe("smoke.example.test");
  assert.equal(tenantProbe.status, 200, `Verified tenant subdomain must load (got ${tenantProbe.status})`);
  const unknown = await probe("unknown.example.test");
  assert.equal(unknown.status, 404, "Unknown host must be rejected");
  assert.ok(!unknown.body.includes("Example Organisation"), "Unknown host must not disclose tenant branding");
  assert.equal((await probe("unknown.localhost")).status, 404, "Unregistered localhost tenant must be rejected");
  console.log("Smoke tenant hosts: verified smoke.example.test 200; unknown.example.test and unknown.localhost 404; no tenant branding leaked.");
  await run([...compose, "run", "--rm", "--no-deps", "migrate"], { capture: true });
  console.log("Smoke migration: second run succeeded with the canonical checksum/lock runner.");
  console.log("Smoke PASS: local deployment only; no cloud calls or provider credentials.");
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : "Smoke failed; runtime details withheld.");
  process.exitCode = 1;
} finally {
  try { await clean(); } catch { console.error("Smoke cleanup failed; remove this run's named resources manually."); process.exitCode = 1; }
}
