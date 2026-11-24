import { authorizationMetadata } from "@opentenant/developer-mcp";
import { developerMcpServerConfig } from "../../api/mcp/server-config";
export async function GET() { const config = developerMcpServerConfig(); return config.enabled ? Response.json(authorizationMetadata(config), { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 404 }); }
