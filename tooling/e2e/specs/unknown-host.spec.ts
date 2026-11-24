import { request } from "node:http";
import { test, expect } from "@playwright/test";
import { readManifest, root, withFixtureControl, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";

let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/f2-unknown-host.log`); manifest = await readManifest(); });
test.afterAll(async () => { await stack?.dispose(); });

// HTTP Host must reach the real Next listener. The UAT gateway rejects
// *.example.test itself, so a gateway-only assertion cannot prove this gate.
function appRequest(host: string, cookie = "", gateway = false) {
  const port = gateway ? manifest.ports.app : manifest.ports.next;
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/", headers: {
      host: `${host}:${port}`, cookie,
      "x-opentenant-host": "alpha.localhost", "x-opentenant-pathname": "/admin",
    }, timeout: 120_000 }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body, headers: response.headers }));
    });
    req.once("timeout", () => req.destroy(new Error("App boundary request timed out")));
    req.once("error", reject); req.end();
  });
}

for (const host of ["unknown.localhost", "unknown.example.test"]) for (const signedIn of [false, true]) {
  test(`unknown valid host returns generic 404 before layout: ${host}, ${signedIn ? "cookie" : "signed out"}`, async () => {
    const cookie = signedIn ? `opentenant_session=${manifest.personas.find(p => p.id === "alpha-owner")!.cookie.value}; opentenant_dev_tenant=alpha` : "";
    const response = await appRequest(host, cookie);
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatch(/^<!doctype html><html lang="en">/);
    expect(response.body).toContain("<h1>Not found</h1>");
    expect(response.body).not.toMatch(/nextjs|next-error|__next|stack|15\.5\.|Alpha|tenant_e2e|webpack|at RootLayout/i);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    if (host.endsWith(".example.test")) {
      const gateway = await appRequest(host, cookie, true);
      expect(gateway.status).toBe(404); expect(gateway.body).toBe("");
      expect(response.body).not.toBe(gateway.body);
    }
  });
}

test("verified hosts and suspended tenants pass the app gate; expired domains do not", async () => {
  test.setTimeout(180_000);
  await withFixtureControl(async db => {
    await db.query(`insert into domains(host,tenant_id,kind,verification,active,challenge_hash,verified_at,verification_valid_until)
      values ('alpha.example.test','tenant_e2e_alpha','custom','verified',true,repeat('a',64),now(),now()+interval '1 day'),
      ('custom.example.test','tenant_e2e_alpha','custom','verified',true,repeat('b',64),now(),now()+interval '1 day')`);
  });
  try {
    for (const host of ["alpha.localhost", "alpha.example.test", "custom.example.test"]) {
      const response = await appRequest(host); expect(response.status).toBe(200); expect(response.body).toContain("Sign in");
    }
    const suspended = await appRequest("suspended.localhost");
    expect(suspended.status).toBe(200); expect(suspended.body).toContain("suspended");
    await withFixtureControl(db => db.query("update domains set verification_valid_until=now()-interval '1 second' where host='custom.example.test'"));
    expect((await appRequest("custom.example.test")).status).toBe(404);
  } finally { await withFixtureControl(db => db.query("delete from domains where host in ('alpha.example.test','custom.example.test')")); }
});
