import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { developerMcpConfig } from "./config";
import { authorizeCode, exchangeCode, authorizationMetadata } from "./oauth";
import { DeveloperMcpStore } from "./runtime-store";
import { migrateControl, proofDatabase } from "./testing/postgres";
const suite = process.env.ADMIN_DATABASE_URL ? describe : describe.skip;
suite("local and Better Auth session OAuth issuer", () => {
  let db: Awaited<ReturnType<typeof proofDatabase>>, store: DeveloperMcpStore;
  const config = developerMcpConfig({ DEVELOPER_MCP_ENABLED: "true" });
  const human = { tenantId: "tenant_oauth", userId: "user_oauth" }, project = "b".repeat(32), verifier = "v".repeat(43);
  const params = () => new URLSearchParams({ project_id: project, client_id: "example", redirect_uri: "http://127.0.0.1:3123/callback", resource: config.resource, response_type: "code", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "example-state" });
  const tokenForm = (code: string) => new URLSearchParams({ code, client_id: "example", redirect_uri: "http://127.0.0.1:3123/callback", resource: config.resource, grant_type: "authorization_code", code_verifier: verifier });
  const code = async () => new URL(await authorizeCode(store, config, params(), human)).searchParams.get("code")!;
  beforeAll(async () => {
    db = await proofDatabase(process.env.ADMIN_DATABASE_URL); await migrateControl(db.pool); store = new DeveloperMcpStore(db.pool);
    await db.pool.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values('tenant_oauth','oauth','Example OAuth','active','us')");
    await db.pool.query("insert into developer_mcp.projects(id,tenant_id,user_id,client_id,profile,consent_scopes,active) values($1,$2,$3,'example','developer.builder@1',array['module.dev.workspace.create','module.dev.preview.open'],true)", [project, human.tenantId, human.userId]);
    await db.pool.query("insert into developer_mcp.oauth_clients values('example','http://127.0.0.1:3123/callback')");
    await store.setSwitch("installation", true, { kind: "installation_owner", userId: "owner" }, "synthetic test"); await store.setSwitch(`tenant:${human.tenantId}`, true, { kind: "installation_owner", userId: "owner" }, "synthetic test");
  }, 120_000);
  afterAll(async () => { await db?.close(); }, 60_000);
  it("publishes code-only PKCE metadata", () => { expect(authorizationMetadata(config).code_challenge_methods_supported).toEqual(["S256"]); });
  it("exchanges once for an audience-bound token and preserves state", async () => {
    const location = new URL(await authorizeCode(store, config, params(), human)); expect(location.searchParams.get("state")).toBe("example-state");
    const form = tokenForm(location.searchParams.get("code")!); const result = await exchangeCode(store, config, form, async () => true);
    expect(result.expires_in).toBe(300);
    expect(await store.transaction(c => store.authority(c, result.access_token, config.resource, human.tenantId))).toMatchObject({ projectId: project });
    await expect(exchangeCode(store, config, form, async () => true)).rejects.toThrow();
  });
  it("rejects wrong PKCE, resource and client without consuming a valid code", async () => {
    const form = tokenForm(await code()); for (const [key,value] of [["code_verifier","x".repeat(43)],["resource","https://foreign.example.test/"],["client_id","foreign"]]) { const bad = new URLSearchParams(form); bad.set(key!, value!); await expect(exchangeCode(store, config, bad, async () => true)).rejects.toThrow(); }
    expect((await exchangeCode(store, config, form, async () => true)).token_type).toBe("Bearer");
  });
  it("rejects foreign users, unregistered redirects and revoked membership", async () => {
    await expect(authorizeCode(store, config, params(), { ...human, userId: "foreign" })).rejects.toThrow();
    const bad = params(); bad.set("redirect_uri", "https://foreign.example.test/"); await expect(authorizeCode(store, config, bad, human)).rejects.toThrow();
    await expect(exchangeCode(store, config, tokenForm(await code()), async () => false)).rejects.toThrow();
  });
  it("rejects expired codes and disabled projects", async () => {
    const form = tokenForm(await code()); await db.pool.query("update developer_mcp.oauth_codes set expires_at=now()-interval '1 second'"); await expect(exchangeCode(store, config, form, async () => true)).rejects.toThrow();
    await db.pool.query("update developer_mcp.projects set active=false"); await expect(authorizeCode(store, config, params(), human)).rejects.toThrow();
  });
});
