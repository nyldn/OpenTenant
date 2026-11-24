import { validateDeveloperMcpRequest } from "./protocol";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function validateRuntimeRequest(headers: Headers, body: unknown) {
  if (!record(body) || body.method !== "tools/call") return validateDeveloperMcpRequest([...headers.entries()], body);
  const fail = () => ({ ok: false as const, error: { code: -32602, message: "Invalid tool call", httpStatus: 400 as const } });
  if (!record(body.params) || Object.keys(body.params).some((key) => !["_meta", "name", "arguments"].includes(key))) return fail();
  if (body.params.name !== "workspace.create" || headers.get("Mcp-Name") !== "workspace.create" || headers.get("Mcp-Method") !== "tools/call") return fail();
  const args = body.params.arguments;
  if (!record(args) || Object.keys(args).length !== 2 || args.templateId !== "opentenant/module-service@1" || typeof args.label !== "string" || !/^[a-zA-Z0-9 _-]{1,64}$/.test(args.label)) return fail();
  // Reuse the complete modern metadata, version, media and envelope validator.
  const projectedHeaders = [...headers.entries()].filter(([key]) => key.toLowerCase() !== "mcp-name")
    .map(([key, value]) => [key, key.toLowerCase() === "mcp-method" ? "tools/list" : value] as const);
  const checked = validateDeveloperMcpRequest(projectedHeaders, { ...body, method: "tools/list", params: { _meta: body.params._meta } });
  if (!checked.ok) return checked;
  return { ok: true as const, request: { ...checked.request, method: "tools/call" as const, params: { ...checked.request.params, name: "workspace.create" as const, arguments: { templateId: args.templateId as string, label: args.label } } } };
}
