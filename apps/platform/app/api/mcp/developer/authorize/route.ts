import { authorizeCode } from "@opentenant/developer-mcp";
import { developerRuntime } from "../composition";
import { browserDenied, browserForm, browserHeaders, browserPage, developerHuman, escapeHtml, registeredDeveloperConsent } from "../browser";
export const runtime = "nodejs";
export async function GET(req: Request) {
  if (!developerRuntime().config.enabled) return new Response(null, { status: 404 });
  const human = await developerHuman(); if (!human) return browserDenied();
  const deps = developerRuntime(), params = new URL(req.url).searchParams;
  const consent = await registeredDeveloperConsent(deps.store, params, human);
  if (!consent) return browserDenied();
  const { authority, redirect, scopes } = consent;
  const response = browserPage(`<h1>Authorize Developer MCP</h1><p>Client: ${escapeHtml(authority.principal.clientId)}</p><p>Project: ${escapeHtml(authority.projectId)}</p><p>Permissions: ${escapeHtml(scopes.join(", "))}</p><form method="post">${[...params].map(([k,v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join("")}<button name="approve" value="yes">Authorize client</button></form>`);
  // Chromium applies form-action to the redirect chain as well. Allow only the
  // registered callback origin after resolving it against the current project.
  response.headers.set("Content-Security-Policy", browserHeaders["Content-Security-Policy"].replace("form-action 'self'", `form-action 'self' ${new URL(redirect).origin}`));
  return response;
}
export async function POST(req: Request) {
  try { const deps = developerRuntime(); if (!deps.config.enabled) return new Response(null, { status: 404 });
    const human = await developerHuman(), form = await browserForm(req); if (!human || form.get("approve") !== "yes") return browserDenied();
    const location = await authorizeCode(deps.store, deps.config, form, human);
    return new Response(null, { status: 303, headers: { ...browserHeaders, "Content-Security-Policy": browserHeaders["Content-Security-Policy"].replace("form-action 'self'", `form-action 'self' ${new URL(location).origin}`), Location: location } });
  } catch { return browserDenied(); }
}
