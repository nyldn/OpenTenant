export const DEVELOPER_MCP_ROUTE = "/api/mcp/developer";
export interface DeveloperMcpConfig {
  enabled: boolean;
  resource: string;
  authorizationServer: string;
  production: boolean;
}
/** OWNER-DEVELOPER-MCP-02 authorizes exactly one route, never a wildcard. */
export function developerMcpConfig(env: Readonly<Record<string, string | undefined>>): DeveloperMcpConfig {
  const production = env.NODE_ENV === "production";
  if (env.DEVELOPER_MCP_ENABLED !== undefined && !["true", "false"].includes(env.DEVELOPER_MCP_ENABLED)) throw new Error("Invalid DEVELOPER_MCP_ENABLED");
  const enabled = env.DEVELOPER_MCP_ENABLED === "true";
  if (enabled && production && env.DEVELOPER_MCP_OWNER_APPROVED_ROUTE !== DEVELOPER_MCP_ROUTE) throw new Error("OWNER-DEVELOPER-MCP-02 approval required for /api/mcp/developer");
  if (enabled && production && (!env.DEVELOPER_MCP_RESOURCE_URL || !env.DEVELOPER_MCP_AUTHORIZATION_SERVER)) throw new Error("Explicit production MCP resource and authorization server required");
  const resource = env.DEVELOPER_MCP_RESOURCE_URL ?? "https://localhost/api/mcp/developer";
  const authorizationServer = env.DEVELOPER_MCP_AUTHORIZATION_SERVER ?? "https://localhost/";
  for (const value of [resource, authorizationServer]) {
    const url = new URL(value);
    if ((url.protocol !== "https:" && !(!production && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.href !== value) throw new Error("Invalid Developer MCP resource configuration");
  }
  if (new URL(resource).pathname !== DEVELOPER_MCP_ROUTE) throw new Error("Invalid Developer MCP resource path");
  return Object.freeze({ enabled, resource, authorizationServer, production });
}
export function protectedResourceMetadata(config: DeveloperMcpConfig) {
  return { resource: config.resource, authorization_servers: [config.authorizationServer], bearer_methods_supported: ["header"] };
}
