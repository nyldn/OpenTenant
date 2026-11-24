import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
/** Shared real startup contract for tarball DX and local registry release proofs. */
export async function proveScaffoldStart(directory, env = process.env) {
  execFileSync("pnpm", ["exec", "tsc", "--noEmit"], { cwd: directory, env, stdio: "inherit" });
  const child = spawn(process.execPath, ["--experimental-strip-types", "server.ts"], { cwd: directory, env, stdio: "inherit" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Host exited early");
      try { const response = await fetch(`http://127.0.0.1:${env.PORT}/`); if (response.status === 200 && (await response.text()).includes("Synthetic tenant ready")) { ready = true; break; } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, "Tenant home must return 200 from the provisioned RLS runtime binding");
    const origin = `http://localhost:${env.PORT}`;
    assert.equal((await fetch(`${origin}/session`)).status, 401);
    const login = env.IDENTITY_PROVIDER === "better-auth"
      ? await fetch(`${origin}/api/auth/better-auth/login`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...JSON.parse(readFileSync(join(directory, ".opentenant-demo-identity.json"), "utf8")), action: "login" }), redirect: "manual" })
      : await fetch(`${origin}/auth/local`, { redirect: "manual" });
    assert.equal(login.status, 303);
    const cookie = login.headers.getSetCookie().map(value => value.split(";",1)[0]).join("; ");
    assert.equal((await fetch(`${origin}/session`, { headers: { cookie } })).status, 200);
    console.log("PASS clean-container tenant home: 200; host typecheck passed");
  } finally { child.kill("SIGTERM"); }

}
