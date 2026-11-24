import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { docker } from "./runtime.mjs";

const refuse = () => { throw new Error("UAT control refused: an owned, running, disposable loopback stack is required."); };
const port = value => Number.isInteger(value) && value > 0 && value < 65536;
export function validateRunRecords(root, { manifest, owner, control }) {
  if (!/^[a-f0-9]{24}$/.test(manifest.runId) || ![manifest, owner, control].every(r => r.worktree === root && r.runId === manifest.runId)) refuse();
  if (!Number.isInteger(owner.pid) || owner.pid <= 1 || typeof owner.stamp !== "string" || !owner.stamp) refuse();
  if (!Object.values(manifest.ports).every(port) || manifest.ports.postgres === 5432 || control.appPort !== manifest.ports.app || !/^[a-f0-9]{64}$/.test(control.stopToken)) refuse();
  const appUrl = value => {
    const url = new URL(value);
    if (url.protocol !== "http:" || !/^[a-z0-9-]+\.localhost$/.test(url.hostname) || Number(url.port) !== manifest.ports.app || url.username || url.password) refuse();
  };
  appUrl(manifest.adminHost);
  manifest.tenants.forEach(t => appUrl(t.url));
  manifest.personas.forEach(p => appUrl(p.signInUrl));
  const mail = new URL(manifest.mailpitUrl);
  if (mail.protocol !== "http:" || mail.hostname !== "127.0.0.1" || Number(mail.port) !== manifest.ports.mailpit || mail.username || mail.password) refuse();
  return { manifest, owner, control };
}

export async function readOwnedRun(root) {
  if (await realpath(root) !== root || await realpath(join(root, ".uat")) !== join(root, ".uat") || await realpath(join(root, ".uat/active")) !== join(root, ".uat/active")) refuse();
  const json = async file => JSON.parse(await readFile(join(root, file), "utf8"));
  const [manifest, owner, control] = await Promise.all([json(".uat/manifest.json"), json(".uat/active/owner.json"), json(".uat/active/control.json")]);
  validateRunRecords(root, { manifest, owner, control });
  const stat = await readFile(`/proc/${owner.pid}/stat`, "utf8");
  if (stat.split(") ")[1].split(" ")[19] !== owner.stamp || await realpath(`/proc/${owner.pid}/cwd`) !== root) refuse();
  return { manifest, owner, control };
}

export function validateDatabaseTargets({ adminUrl, controlUrl, containerName, port: databasePort }, manifest, inspection, root) {
  for (const [value, pathname] of [[adminUrl, "/postgres"], [controlUrl, "/opentenant_ephemeral"]]) {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || Number(url.port) !== databasePort || databasePort !== manifest.ports.postgres || url.pathname !== pathname || url.search || url.hash) refuse();
  }
  const workspace = createHash("sha256").update(root).digest("hex").slice(0, 20);
  if (!/^opentenant-proof-[a-f0-9-]{36}$/.test(containerName) || inspection.Name !== `/${containerName}` || !inspection.State?.Running || inspection.HostConfig?.NetworkMode !== "none" || inspection.Config?.Image !== "pgvector/pgvector:0.8.2-pg17-bookworm") refuse();
  const labels = inspection.Config?.Labels;
  if (labels?.["opentenant.uat"] !== "true" || labels?.["opentenant.uat.run"] !== manifest.runId || labels?.["opentenant.uat.workspace"] !== workspace) refuse();
}

export async function guardDatabase(root, runId, database) {
  const records = await readOwnedRun(root);
  if (records.manifest.runId !== runId || !/^opentenant-proof-[a-f0-9-]{36}$/.test(database.containerName)) refuse();
  const [inspection] = JSON.parse(docker(["inspect", database.containerName]));
  validateDatabaseTargets(database, records.manifest, inspection, root);
  return records;
}
