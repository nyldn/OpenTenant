import {
  DEVELOPER_PERMISSION_RISKS,
  type AssignablePermissionSlug,
  type DeveloperRiskClass,
} from "./slugs";

type StringField = Readonly<{
  type: "string";
  minLength: number;
  maxLength: number;
  pattern?: string;
  enum?: readonly string[];
  enumSource?: "server-contract-catalogue" | "template-fixed-command-set";
}>;
type IntegerField = Readonly<{ type: "integer"; minimum: number; maximum: number }>;
export type DeveloperToolField = StringField | IntegerField;
export type DeveloperResourceType = "module_project" | "module_workspace";

export type DeveloperToolDescriptor = Readonly<{
  name: string;
  description: string;
  schemaVersion: "1";
  slug: AssignablePermissionSlug;
  risk: DeveloperRiskClass;
  resourceType: DeveloperResourceType;
  request: Readonly<{
    type: "object";
    additionalProperties: false;
    properties: Readonly<Record<string, DeveloperToolField>>;
    required: readonly string[];
  }>;
}>;

const cursor = Object.freeze({ type: "string", minLength: 1, maxLength: 128 } as const);
const pageLimit = Object.freeze({ type: "integer", minimum: 1, maximum: 50 } as const);
const opaqueId = Object.freeze({ type: "string", minLength: 32, maxLength: 32, pattern: "^[0-9a-f]{32}$" } as const);
const label = Object.freeze({ type: "string", minLength: 1, maxLength: 64 } as const);
const templateId = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 27,
  enum: Object.freeze(["opentenant/module-ui-next@1", "opentenant/module-service@1"]),
} as const);
const contractId = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 128,
  enum: Object.freeze([] as string[]),
  enumSource: "server-contract-catalogue",
} as const);
const command = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 64,
  enum: Object.freeze([] as string[]),
  enumSource: "template-fixed-command-set",
} as const);

function freezeField(field: DeveloperToolField): DeveloperToolField {
  if (field.type === "string") {
    return Object.freeze({
      ...field,
      ...(field.enum === undefined ? {} : { enum: Object.freeze([...field.enum]) }),
    });
  }
  return Object.freeze({ ...field });
}

function descriptor(
  name: string,
  description: string,
  slug: AssignablePermissionSlug,
  resourceType: DeveloperResourceType,
  properties: Readonly<Record<string, DeveloperToolField>>,
  required: readonly string[],
): DeveloperToolDescriptor {
  const frozenProperties = Object.freeze(Object.fromEntries(
    Object.entries(properties).map(([key, field]) => [key, freezeField(field)]),
  ) as Record<string, DeveloperToolField>);
  return Object.freeze({
    name,
    description,
    schemaVersion: "1",
    slug,
    risk: DEVELOPER_PERMISSION_RISKS[slug],
    resourceType,
    request: Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: frozenProperties,
      required: Object.freeze(required),
    }),
  });
}

export const DEVELOPER_TOOL_DESCRIPTORS = Object.freeze([
  descriptor("workspace.list", "Lists module development workspaces available to the authorized caller.", "module.dev.workspace.read", "module_project", { cursor, limit: pageLimit }, []),
  descriptor("workspace.get", "Returns one authorized module development workspace by identifier.", "module.dev.workspace.read", "module_workspace", { workspaceId: opaqueId }, ["workspaceId"]),
  descriptor("workspace.create", "Creates a module development workspace from an approved server-owned template.", "module.dev.workspace.create", "module_project", { templateId, label }, ["templateId", "label"]),
  descriptor("workspace.resume", "Resumes an archived authorized module development workspace.", "module.dev.workspace.lifecycle", "module_workspace", { workspaceId: opaqueId }, ["workspaceId"]),
  descriptor("workspace.snapshot", "Creates a labelled snapshot of an authorized module development workspace.", "module.dev.workspace.lifecycle", "module_workspace", { workspaceId: opaqueId, label }, ["workspaceId", "label"]),
  descriptor("workspace.archive", "Archives an authorized module development workspace.", "module.dev.workspace.lifecycle", "module_workspace", { workspaceId: opaqueId }, ["workspaceId"]),
  descriptor("contract.list", "Lists development contracts available to the authorized caller.", "module.dev.contract.read", "module_project", { cursor, limit: pageLimit }, []),
  descriptor("contract.get", "Returns one authorized development contract by server-owned identifier.", "module.dev.contract.read", "module_project", { contractId }, ["contractId"]),
  descriptor("build.run", "Runs an approved server-owned build command in an authorized workspace.", "module.dev.build.execute", "module_workspace", { workspaceId: opaqueId, command }, ["workspaceId", "command"]),
  descriptor("preview.open", "Opens an authenticated preview for an authorized module development workspace.", "module.dev.preview.open", "module_workspace", { workspaceId: opaqueId }, ["workspaceId"]),
  descriptor("evidence.list", "Lists development evidence available for an authorized workspace.", "module.dev.evidence.read", "module_workspace", { workspaceId: opaqueId, cursor }, ["workspaceId"]),
  descriptor("evidence.get", "Returns one authorized development evidence record by identifier.", "module.dev.evidence.read", "module_workspace", { evidenceId: opaqueId }, ["evidenceId"]),
] as const);
