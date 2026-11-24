import { readFileSync } from "node:fs";
import { DEVELOPER_MCP_SCHEMA } from "./runtime-schema";
import { describe, expect, it } from "vitest";
import { developerMcpConfig, protectedResourceMetadata } from "./config";
import { validateRuntimeRequest } from "./runtime-protocol";
describe("MCP configuration and transport", () => {
  it("ships the exact runtime DDL through a forward canonical migration", () => {
    expect(readFileSync(new URL("../../../tooling/migrations/sql/control-plane/0070_developer_mcp_runtime.sql", import.meta.url), "utf8").trim()).toBe(DEVELOPER_MCP_SCHEMA.trim());
  });
  it("defaults off and rejects production without the exact owner approval", () => {
    expect(developerMcpConfig({}).enabled).toBe(false);
    expect(() => developerMcpConfig({ NODE_ENV: "production", DEVELOPER_MCP_ENABLED: "true" })).toThrow("OWNER-DEVELOPER-MCP-02");
    expect(() => developerMcpConfig({ DEVELOPER_MCP_ENABLED: "1" })).toThrow();
  });
  it("builds metadata only from exact configured HTTPS identity", () => {
    const config = developerMcpConfig({ DEVELOPER_MCP_RESOURCE_URL: "https://tenant.example.test/api/mcp/developer", DEVELOPER_MCP_AUTHORIZATION_SERVER: "https://auth.example.test/" });
    expect(protectedResourceMetadata(config)).toEqual({ resource: "https://tenant.example.test/api/mcp/developer", authorization_servers: ["https://auth.example.test/"], bearer_methods_supported: ["header"] });
    for (const resource of ["http://tenant.example.test/api/mcp/developer", "https://user:secret@example.test/api/mcp/developer", "https://tenant.example.test/api/mcp/developer?token=x"]) expect(() => developerMcpConfig({ DEVELOPER_MCP_RESOURCE_URL: resource })).toThrow();
  });
  it("rejects legacy sessions, unregistered methods and forged authority metadata", () => {
    const req = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} }, name: "workspace.create", arguments: { templateId: "opentenant/module-service@1", label: "Example" } } };
    const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "workspace.create" });
    expect(validateRuntimeRequest(headers, req).ok).toBe(true);
    expect(validateRuntimeRequest(headers, { ...req, params: { ...req.params, _meta: { ...req.params._meta, tenantId: "forged" } } }).ok).toBe(false);
    expect(validateRuntimeRequest(headers, { ...req, method: "initialize" }).ok).toBe(false);
  });
});
