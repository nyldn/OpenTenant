import { createDeveloperMcpHandler } from "@opentenant/developer-mcp";
import { developerMcpServerConfig } from "../server-config";
import { developerRuntime } from "./composition";
export const runtime = "nodejs";
const disabled = () => Response.json({ error: "disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request) {
  if (!developerMcpServerConfig().enabled) return disabled();
  return createDeveloperMcpHandler(developerRuntime())(request);
}
export { handle as POST, handle as GET };
