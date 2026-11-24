import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { images, docker, pull, ownedContainer, run, assertReport } from "./docker.mjs";
const start = performance.now();
const container = ownedContainer();
const output = mkdtempSync(join(tmpdir(), "opentenant-smtp-"));
let passed = false;
try {
  pull(images.mailpit);
  pull(images.postgres);
  docker(["tag", images.postgres, "pgvector/pgvector:0.8.2-pg17-bookworm"]);
  docker(["run", "--rm", "-d", "--name", container.name, "--label", "opentenant.proof=smtp",
    "-p", "127.0.0.1::1025", "-p", "127.0.0.1::8025", "--env", "MP_MAX_MESSAGES=100",
    "--env", "MP_SMTP_AUTH_ACCEPT_ANY=1", "--env", "MP_SMTP_AUTH_ALLOW_INSECURE=1", images.mailpit]);
  const ports = JSON.parse(docker(["inspect", container.name]))[0].NetworkSettings.Ports;
  const env = { ...process.env, MAILPIT_REQUIRED: "1", MAILPIT_HTTP_URL: `http://127.0.0.1:${ports["8025/tcp"][0].HostPort}`, MAILPIT_SMTP_PORT: ports["1025/tcp"][0].HostPort };
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${env.MAILPIT_HTTP_URL}/api/v1/info`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded readiness */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Mailpit failed readiness within 30 seconds");
  const transportReport = join(output, "transport.json");
  run("pnpm", ["--filter", "@opentenant/notifications", "exec", "vitest", "run", "src/mailpit.integration.test.ts", "--reporter=default", "--reporter=json", `--outputFile=${transportReport}`], env);
  assertReport(JSON.parse(readFileSync(transportReport, "utf8")), 1);
  const flowReport = join(output, "flows.json");
  // The canonical harness supplies a fresh pgvector database and never skips.
  run("pnpm", ["db:ephemeral", "--", "pnpm", "--filter", "@opentenant/testing", "exec", "vitest", "run", "src/smtp.integration.test.ts", "--reporter=default", "--reporter=json", `--outputFile=${flowReport}`], env);
  assertReport(JSON.parse(readFileSync(flowReport, "utf8")), 3);
  passed = true;
} finally {
  await container.dispose();
  rmSync(output, { recursive: true, force: true });
  console.log(JSON.stringify({ proof: "smtp", passed, expectedTests: 4, totalSeconds: Number(((performance.now() - start) / 1000).toFixed(3)), image: images.mailpit }));
}
