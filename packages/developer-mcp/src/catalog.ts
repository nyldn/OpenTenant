import { MAX_AUTHORITY_STALENESS_MS } from "./revocation";
import type { AssignablePermissionSlug } from "./slugs";
import { DEVELOPER_TOOL_DESCRIPTORS } from "./tools";

export const DEVELOPER_TOOL_LIST_CACHE_POLICY = Object.freeze({
  cacheScope: "private",
  ttlMs: MAX_AUTHORITY_STALENESS_MS,
} as const);

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

function hasEmptyEnum(descriptor: (typeof DEVELOPER_TOOL_DESCRIPTORS)[number]): boolean {
  return Object.values(descriptor.request.properties).some(
    (field) => field.type === "string" && field.enum?.length === 0,
  );
}

function projectProperties(properties: (typeof DEVELOPER_TOOL_DESCRIPTORS)[number]["request"]["properties"]) {
  return Object.freeze(Object.fromEntries(Object.entries(properties).map(([name, field]) => {
    if (field.type === "integer") return [name, Object.freeze({ ...field })];
    const { enumSource: _internalEnumSource, ...wireField } = field;
    return [name, Object.freeze({
      ...wireField,
      ...(wireField.enum === undefined ? {} : { enum: Object.freeze([...wireField.enum]) }),
    })];
  })));
}

export function buildToolList(authority: readonly AssignablePermissionSlug[]) {
  const allowed = new Set(authority);
  const tools = DEVELOPER_TOOL_DESCRIPTORS
    .filter((descriptor) => allowed.has(descriptor.slug) && !hasEmptyEnum(descriptor))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(({ name, description, request }) => Object.freeze({
      name,
      description,
      inputSchema: Object.freeze({
        $schema: JSON_SCHEMA_2020_12,
        type: request.type,
        additionalProperties: request.additionalProperties,
        properties: projectProperties(request.properties),
        required: request.required,
      }),
    }));
  return Object.freeze({
    resultType: "complete",
    tools: Object.freeze(tools),
    ttlMs: DEVELOPER_TOOL_LIST_CACHE_POLICY.ttlMs,
    cacheScope: DEVELOPER_TOOL_LIST_CACHE_POLICY.cacheScope,
  });
}

export function serializeToolList(authority: readonly AssignablePermissionSlug[]): string {
  return JSON.stringify(buildToolList(authority));
}
