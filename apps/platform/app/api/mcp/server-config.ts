import { configurationEnvironment } from "../../../lib/server-config";
import { developerMcpConfig } from "@opentenant/developer-mcp/config";

/** Kept in the assigned MCP directory. Global startup must call this validator too. */
export function developerMcpServerConfig() {
  return developerMcpConfig(configurationEnvironment());
}
