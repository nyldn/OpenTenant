import { exchangeDeveloperPreview } from "@opentenant/developer-mcp";
import { developerMcpServerConfig } from "../../server-config";
import { developerRuntime } from "../composition";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!developerMcpServerConfig().enabled) return Response.json({ error: "disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return exchangeDeveloperPreview(developerRuntime(), request);
}
