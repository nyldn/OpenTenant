import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { runDeveloperRouteBrowserProof } from "../../proofs/developer-mcp-route.mjs";
import { test, expect, signIn } from "./fixtures";
import { withControl } from "./operations";
test("browser confirms a tenant/user/client/input-bound mutation with no automatic approval", async ({ page, request }) => {
  await signIn(page);
  const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  expect((await request.get(`${origin}/api/mcp/developer/confirm`)).status()).toBe(403);
  await page.goto("/api/mcp/developer/confirm");
  await expect(page.getByRole("heading", { name: "Confirm workspace creation" })).toBeVisible();
  await page.getByLabel("Project ID").fill("c".repeat(32));
  await page.getByLabel("Workspace label").fill("Browser example");
  const before = await withControl(async db => Number((await db.query("select count(*) from developer_mcp.confirmations")).rows[0].count));
  await page.getByRole("button", { name: "Confirm creation" }).click();
  await expect(page.getByRole("heading", { name: "Creation confirmed" })).toBeVisible();
  const secret = await page.locator("output").textContent();
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  await withControl(async db => {
    const rows = await db.query("select * from developer_mcp.confirmations"); expect(rows.rowCount).toBe(before+1);
    expect(rows.rows.at(-1)).toMatchObject({ digest: createHash("sha256").update(secret!).digest("hex"), tenant_id: "tenant_e2e", client_id: "browser-example", project_id: "c".repeat(32), consumed: false });
    expect(rows.rows.at(-1).expires_at.getTime()-Date.now()).toBeLessThanOrEqual(60_000);
  });
  expect((await page.request.post(`${origin}/api/mcp/developer/confirm`, { headers: { origin: "https://foreign.example.test" }, form: { project: "c".repeat(32), label: "Browser example", approve: "yes" } })).status()).toBe(403);
  expect((await page.request.post(`${origin}/api/mcp/developer/confirm`, { headers: { origin }, form: { project: "f".repeat(32), label: "Browser example", approve: "yes" } })).status()).toBe(403);
});
test("callable route executes in real microVM and destroys it before preview", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page); const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  const metadata = await page.request.get(`${origin}/.well-known/oauth-protected-resource/api/mcp/developer`);
  expect(await metadata.json()).toMatchObject({ resource: `${origin}/api/mcp/developer`, authorization_servers: [`${origin}/`] });
  const issuer = await page.request.get(`${origin}/.well-known/oauth-authorization-server`); expect(await issuer.json()).toMatchObject({ issuer: `${origin}/`, code_challenge_methods_supported: ["S256"] });
  const receiver = createServer((_req, res) => res.end("Authorized"));
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${(receiver.address() as import("node:net").AddressInfo).port}/callback`;
  await withControl(db => db.query("update developer_mcp.oauth_clients set redirect_uri=$1 where client_id='browser-example'", [redirect]));
  try {
  const verifier = "v".repeat(43);
  const params = new URLSearchParams({ project_id: "c".repeat(32), client_id: "browser-example", redirect_uri: redirect, resource: `${origin}/api/mcp/developer`, response_type: "code", state: "browser-state", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  await page.goto(`/api/mcp/developer/authorize?${params}`);
  await page.getByRole("button", { name: "Authorize client" }).click();
  await expect(page).toHaveURL(/\/callback\?code=/u);
  const callback = new URL(page.url()); expect(callback.searchParams.get("state")).toBe("browser-state");
  const form = { grant_type: "authorization_code", code: callback.searchParams.get("code")!, code_verifier: verifier, client_id: "browser-example", redirect_uri: redirect, resource: `${origin}/api/mcp/developer` };
  const response = await page.request.post(`${origin}/api/mcp/developer/token`, { form }); expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ token_type: "Bearer", expires_in: 300 });
  expect((await page.request.post(`${origin}/api/mcp/developer/token`, { form })).status()).toBe(400);
  } finally { receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve())); }
  await runDeveloperRouteBrowserProof(page);
});
