// Versioned contract. Cell IDs never contain disposable IDs or credentials.
export const SCHEMA_VERSION = 2;
export const PERSONAS = ["signed-out", "installation-owner", "tenant-owner", "admin", "member", "managed-support"];
export const VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
export const ROUTES = [
  ["home", "/"], ["tenants", "/tenants"], ["sign-in", "/sign-in"], ["sign-up", "/sign-up"],
  ...["", "/activity", "/branding", "/connections", "/domains", "/identity", "/members", "/modules", "/navigation"].map(p => [`settings${p.replaceAll("/", "-")}`, `/settings${p}`]),
  ...["", "/audit", "/helpdesk", "/support", "/tenants/new", "/tenants/{tenant}", "/tenants/{tenant}/brand-proposals", "/tenants/{tenant}/owner-claim"].map(p => [`admin${p.replaceAll("/", "-")}`, `/admin${p}`]),
  ["assessment", "/assessment"], ["assessment-dimensions", "/assessment?uatStage=dimensions"], ["assessment-results", "/assessment?uatStage=results"],
  ["knowledge", "/brain"], ["support", "/support"], ["support-ticket", "/support/{ticket}"],
  ["access-assessment", "/access/assessment"], ["remote-fixture", "/m/e2e-stub"],
  ["mcp-authorize", "/api/mcp/developer/authorize"], ["mcp-confirm", "/api/mcp/developer/confirm"],
  ["beta-home", "/", "beta"], ["hostile-home", "/", "hostile"], ["fresh-home", "/", "fresh"], ["pending-claim", "/admin/tenants/tenant_uat_pending/owner-claim", "pending"],
  ["helpdesk-workspace-ticket", "/admin/helpdesk/tenant_e2e/SUP-000001"],
  ["helpdesk-alpha-ticket", "/admin/helpdesk/tenant_e2e_alpha/SUP-000001"],
  ["access-remote-fixture", "/access/e2e-stub"], ["auth-login", "/auth/login"],
].map(([id, route, host]) => ({ id: /** @type {string} */ (id), route: /** @type {string} */ (route), host }));
export const CELLS = ROUTES.flatMap(route => PERSONAS.flatMap(persona => VIEWPORTS.map(viewport => ({ id: `${persona}|${route.id}|${viewport.width}x${viewport.height}`, persona, route, viewport }))));
if (CELLS.length !== 702 || new Set(CELLS.map(c => c.id)).size !== 702) throw new Error("Audit inventory must contain 702 unique cells");
export const batchRoutes = index => ROUTES.slice(index * 5, index * 5 + 5);
export const BATCH_COUNT = Math.ceil(ROUTES.length / 5);
