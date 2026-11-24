import type { ModuleHostServices } from "@opentenant/database/module-host";
import { verifyModuleContext } from "@opentenant/security";
import { BRAIN_MANIFEST } from "./manifest";
import { brainAuthority, brainCall, type BrainCallOptions } from "./service";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

const TOOLS = {
  search: { permission: "brain.use", description: "Search validated context and raw signal chunks." },
  get_decision: { permission: "brain.use", description: "Fetch a single decision-log entry with citations." },
  get_brand_md: { permission: "brain.use", description: "Read tenant-authored brand markdown for agent grounding." },
  promote_signal: { permission: "brain.promote", description: "Promote a raw signal into validated context." },
} as const;

type ToolName = keyof typeof TOOLS;

interface ToolCallRequest {
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
  tool?: string;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function toolNameFrom(body: ToolCallRequest): string | null {
  if (body.method === "tools/call" && typeof body.params?.name === "string") return body.params.name;
  if (typeof body.tool === "string") return body.tool;
  return null;
}

function listedTools() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    requiredPermission: tool.permission,
  }));
}

function brainIdentity(req: Request, host: ModuleHostServices) {
  const publicKey = host.serverConfig().MODULE_SIGNING_PUBLIC_KEY;
  if (!publicKey) {
    return error(500, "module_signing_not_configured", "MODULE_SIGNING_PUBLIC_KEY is not configured.");
  }

  const token = req.headers.get("x-opentenant-module-context");
  if (!token) return error(401, "missing_module_context", "Signed brain module context is required.");

  const verified = verifyModuleContext(token, publicKey, {
    moduleKey: BRAIN_MANIFEST.key,
    moduleVersion: BRAIN_MANIFEST.version,
  });
  if (!verified.valid) {
    return error(401, "invalid_module_context", `Brain module context is invalid: ${verified.reason}.`);
  }
  if (verified.claims.userId === null) {
    return error(403, "identity_required", "Brain MCP access requires an identity-backed module context.");
  }

  return { tenantId: verified.claims.tenantId, userId: verified.claims.userId, permissions: verified.claims.permissions };
}

export async function handleBrainRequest(req: Request, host: ModuleHostServices, options: BrainCallOptions = {}): Promise<Response> {
  const identity = brainIdentity(req, host);
  if (identity instanceof Response) return identity;
  let body: ToolCallRequest = {};
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return error(400, "invalid_request", "Invalid request.");
    body = raw as ToolCallRequest;
  } catch {
    body = {};
  }

  const livePermissions: readonly string[] = await brainAuthority(host, identity.tenantId, identity.userId).catch(() => []);
  const permissions = identity.permissions.filter((permission) => livePermissions.includes(permission));

  // Tool discovery is permission-gated like the tools themselves; an
  // identity-valid context with no grants learns nothing about the surface.
  if (body.method === "tools/list") {
    if (!permissions.includes("brain.use")) {
      return error(403, "permission_denied", "tools/list requires brain.use.");
    }
    return json(200, { tools: listedTools() });
  }

  const toolName = toolNameFrom(body);
  if (toolName === null) {
    return error(400, "invalid_request", "Use method tools/list or tools/call.");
  }
  if (!Object.hasOwn(TOOLS, toolName)) {
    return error(403, "permission_denied", `Unknown brain tool: ${toolName}.`);
  }

  const tool = TOOLS[toolName as ToolName];
  if (tool.permission === "brain.promote" && !permissions.includes("brain.promote")) {
    return error(403, "permission_denied", `${toolName} requires brain.promote, which is not granted.`);
  }
  if (!permissions.includes("brain.use")) {
    return error(403, "permission_denied", `${toolName} requires brain.use.`);
  }

  const args = body.params?.arguments ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) return error(400, "invalid_request", "Invalid tool arguments.");
  try {
    const result = await brainCall(host, identity.tenantId, identity.userId, permissions, toolName as ToolName, args, options);
    return json(200, { resultType: "complete", content: [{ type: "text", text: JSON.stringify(result) }], _meta: { trust: "untrusted_tenant_content" } });
  } catch {
    return error(400, "tool_unavailable", "Brain tool could not complete.");
  }
}
