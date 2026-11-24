import { afterEach, describe, expect, it } from "vitest";
import { developerMcpConfig } from "@opentenant/developer-mcp";
import { POST } from "./developer/route";
afterEach(() => { delete process.env.DEVELOPER_MCP_ENABLED; });
describe("Developer MCP owner gate", () => {
  it("is disabled unless flagged, including the actual route", async () => {
    expect(developerMcpConfig({}).enabled).toBe(false);
    expect(developerMcpConfig({ DEVELOPER_MCP_ENABLED: "false" }).enabled).toBe(false);
    expect((await POST(new Request("https://localhost/api/mcp/developer", { method: "POST" }))).status).toBe(404);
    expect(developerMcpConfig({ DEVELOPER_MCP_ENABLED: "true" }).enabled).toBe(true);
  });
  it("rejects production enablement without exact OWNER-DEVELOPER-MCP-02 route approval", () => {
    for (const approval of [undefined, "true", "*", "/api/mcp/brain"]) expect(() => developerMcpConfig({ NODE_ENV: "production", DEVELOPER_MCP_ENABLED: "true", DEVELOPER_MCP_OWNER_APPROVED_ROUTE: approval })).toThrow("OWNER-DEVELOPER-MCP-02");
    expect(developerMcpConfig({ NODE_ENV: "production", DEVELOPER_MCP_ENABLED: "true", DEVELOPER_MCP_OWNER_APPROVED_ROUTE: "/api/mcp/developer", DEVELOPER_MCP_RESOURCE_URL: "https://tenant.example.test/api/mcp/developer", DEVELOPER_MCP_AUTHORIZATION_SERVER: "https://auth.example.test/" }).enabled).toBe(true);
  });
});
