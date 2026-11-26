import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { waitFor } from "./runtime.mjs";
export const MAILPIT_IMAGE = "axllent/mailpit:v1.27.8@sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707";
export const POSTGRES_IMAGE = "pgvector/pgvector:0.8.2-pg17-bookworm@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966";
const docker = args => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
// The shared DB launcher uses the compose tag. Verify its immutable identity.
export function verifyPostgresImage() {
  const image = JSON.parse(docker(["image", "inspect", POSTGRES_IMAGE.split("@")[0]]))[0];
  if (!image.RepoDigests.includes(POSTGRES_IMAGE.replace(":0.8.2-pg17-bookworm", ""))) throw new Error("Load the pinned pgvector image documented in docs/tooling/e2e.md");
}
const pullImage = promisify(execFile);

/** The demo can fetch the same immutable images that UAT expects in its cache. */
export async function prepareDemoImages(signal) {
  try {
    verifyPostgresImage();
  } catch {
    await pullImage("docker", ["pull", POSTGRES_IMAGE], { signal, timeout: 300_000 });
    docker(["tag", POSTGRES_IMAGE, POSTGRES_IMAGE.split("@")[0]]);
    verifyPostgresImage();
  }
  try {
    docker(["image", "inspect", MAILPIT_IMAGE]);
  } catch {
    await pullImage("docker", ["pull", MAILPIT_IMAGE], { signal, timeout: 300_000 });
  }
}

export async function startMailpit({ name, labels = {}, signal } = {}) {
  const dispose = async () => {
    if (docker(["ps", "-aq", "--filter", `name=^/${name}$`])) docker(["rm", "-fv", name]);
  };
  try {
    docker(["run", "--rm", "--pull=never", "-d", "--name", name,
      ...Object.entries(labels).flatMap(([k,v]) => ["--label", `${k}=${v}`]),
      "-p", "127.0.0.1::8025", "-p", "127.0.0.1::1025", "--env", "MP_MAX_MESSAGES=200", MAILPIT_IMAGE]);
    const ports = JSON.parse(docker(["inspect", name]))[0].NetworkSettings.Ports;
    const mailPort = Number(ports["8025/tcp"][0].HostPort), smtpPort = Number(ports["1025/tcp"][0].HostPort);
    const url = `http://127.0.0.1:${mailPort}`;
    await waitFor(`${url}/api/v1/info`, signal);
    const messages = await fetch(`${url}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
    if (!messages.ok || !Array.isArray((await messages.json()).messages)) throw new Error("Mailpit read-back failed");
    return { mailPort, smtpPort, url, dispose };
  } catch (error) { await dispose(); throw error; }
}

export async function captureMailSeed(mail, directory) {
  const { createRequire } = await import("node:module");
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const require = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
  const { SmtpEmailTransport } = await import(require.resolve("@opentenant/notifications/smtp"));
  const read = async path => {
    const response = await fetch(`${mail.url}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Mailpit seed read-back failed");
    return response.json();
  };
  const index = await read("/api/v1/messages?limit=200");
  if (index.messages.length !== index.total) throw new Error("Incomplete Mailpit seed");
  const messages = [];
  for (const message of index.messages) {
    const data = await read(`/api/v1/message/${message.ID}`);
    if (data.To.length !== 1) throw new Error("UAT seed requires single-recipient messages");
    messages.push({ to: data.To[0].Address, subject: data.Subject, text: data.Text, html: data.HTML ?? "" });
  }
  await writeFile(join(directory, "mailpit-seed.json"), JSON.stringify(messages), { mode: 0o600 });
  return { async restore() {
    const cleared = await fetch(`${mail.url}/api/v1/messages`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
    if (!cleared.ok) throw new Error("Mailpit seed reset failed");
    const transport = new SmtpEmailTransport({ host: "127.0.0.1", port: mail.smtpPort, from: "noreply@example.test", secure: false });
    for (const [i,message] of messages.entries()) {
      if (!(await transport.send({ ...message, idempotencyKey: `uat-reset-seed-${i}` })).ok) throw new Error("Mailpit seed replay failed");
    }
    const restored = await read("/api/v1/messages?limit=200");
    if (restored.total !== messages.length) throw new Error("Mailpit seed count differs");
    const canonical = m => JSON.stringify([m.to, m.subject, m.text.replaceAll("\r\n", "\n").trim()]);
    const actual = [];
    for (const message of restored.messages) {
      const data = await read(`/api/v1/message/${message.ID}`);
      actual.push(canonical({ to: data.To[0].Address, subject: data.Subject, text: data.Text }));
    }
    if (JSON.stringify(actual.sort()) !== JSON.stringify(messages.map(canonical).sort())) throw new Error("Mailpit seed content differs");
  } };
}
