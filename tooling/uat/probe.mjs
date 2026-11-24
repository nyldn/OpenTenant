// Reproducible live HTTP/binding proof. Does not print credential values.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const manifest = JSON.parse(await readFile(new URL("../../.uat/manifest.json", import.meta.url), "utf8"));
const curl = (url, cookie, method = "GET") => {
  const target = new URL(url);
  return execFileSync("curl", ["-X", method, "--noproxy", "*", "--silent", "--show-error", "--max-time", "180", "-i", "-H", `Host: ${target.host}`, ...(cookie ? ["-H", `Cookie: ${cookie}`] : []), `http://127.0.0.1:${manifest.ports.app}${target.pathname}${target.search}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
};
for (const tenant of manifest.tenants) {
  const response = curl(tenant.url);
  assert.equal(response.split(" ", 2)[1], "200");
  console.log(`curl Host=${new URL(tenant.url).host}: 200`);
}
for (const persona of manifest.personas) {
  const response = curl(persona.signInUrl);
  assert.equal(response.split(" ", 2)[1], "200");
  const cookie = response.match(/set-cookie: ([^;\r\n]+)/iu)?.[1];
  assert.ok(cookie);
  const url = new URL(persona.signInUrl);
  url.pathname = persona.id === "installation-owner" ? "/admin" : persona.id === "managed-support" ? "/admin/support" : persona.id === "no-memberships" ? "/tenants" : "/";
  url.search = "";
  const authenticated = curl(url.href, cookie);
  assert.equal(authenticated.split(" ", 2)[1], "200", `Unexpected response for ${persona.id}`);
  if (!["installation-owner", "managed-support", "no-memberships", "suspended-owner"].includes(persona.id)) assert.ok(authenticated.includes(persona.email), `Missing session for ${persona.id}`);
  if (persona.id === "no-memberships") assert.ok(authenticated.includes("You have no tenant memberships available."));
  if (persona.id === "managed-support") assert.ok(authenticated.includes("Start 30-minute session"));
  console.log(`sign-in ${persona.id}: session accepted`);
}
const suspended = manifest.tenants.find(t => t.slug === "suspended");
assert.equal(curl(`${suspended.url}api/support/tickets`, undefined, "POST").split(" ", 2)[1], "423");
console.log("suspended API: 423");
const listeners = execFileSync("ss", ["-ltnH"], { encoding: "utf8" }).trim().split("\n");
for (const port of Object.values(manifest.ports)) {
  const endpoints = listeners.map(line => line.trim().split(/\s+/u)[3]).filter(value => value?.endsWith(`:${port}`));
  assert.deepEqual(endpoints, [`127.0.0.1:${port}`]);
  console.log(`ss -ltn: 127.0.0.1:${port}`);
}
const mail = await (await fetch(`${manifest.mailpitUrl}/api/v1/messages`)).json();
assert.ok(mail.total >= 7, "Owner invitations must reach Mailpit");
console.log(`Mailpit: ${mail.total} synthetic invitations`);
