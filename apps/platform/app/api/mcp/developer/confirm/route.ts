import { projectAuthority } from "@opentenant/developer-mcp";
import { developerRuntime } from "../composition";
import { browserDenied, browserForm, browserPage, developerHuman, escapeHtml } from "../browser";
export const runtime = "nodejs";
export async function GET() {
  if (!developerRuntime().config.enabled) return new Response(null, { status: 404 });
  if (!await developerHuman()) return browserDenied();
  return browserPage('<h1>Confirm workspace creation</h1><p>This creates one synthetic service workspace. Approval expires in 60 seconds and can be used once by the registered client.</p><form method="post"><label>Project ID <input name="project" required></label><label>Workspace label <input name="label" maxlength="64" required></label><button name="approve" value="yes">Confirm creation</button></form>');
}
export async function POST(req: Request) {
  try { const deps = developerRuntime(); if (!deps.config.enabled) return new Response(null, { status: 404 });
    const human = await developerHuman(), form = await browserForm(req);
    if (!human || form.get("approve") !== "yes" || !/^[a-f0-9]{32}$/u.test(form.get("project") ?? "") || !/^[A-Za-z0-9 _-]{1,64}$/u.test(form.get("label") ?? "")) return browserDenied();
    const authority = await deps.store.transaction(client => projectAuthority(deps.store, client, form.get("project")!, human));
    if (!authority || !await deps.membershipActive(authority.principal)) return browserDenied();
    const secret = await deps.store.confirm(authority, { templateId: "opentenant/module-service@1", label: form.get("label")! }, human);
    return browserPage(`<h1>Creation confirmed</h1><p>Give this one-use confirmation to your registered MCP client.</p><output>${escapeHtml(secret)}</output>`);
  } catch { return browserDenied(); }
}
