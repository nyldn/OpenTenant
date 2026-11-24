import { exchangeCode } from "@opentenant/developer-mcp";
import { developerRuntime } from "../composition";
import { browserHeaders, oauthForm } from "../browser";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try { const deps = developerRuntime(); if (!deps.config.enabled) return new Response(null, { status: 404 });
    return Response.json(await exchangeCode(deps.store, deps.config, await oauthForm(req), deps.membershipActive), { headers: browserHeaders });
  } catch { return Response.json({ error: "invalid_grant" }, { status: 400, headers: browserHeaders }); }
}
