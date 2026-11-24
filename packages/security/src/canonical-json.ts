export function canonicalJsonStringify(value: unknown): string | undefined {
  return serialize(value, "", new Set<object>());
}

function serialize(value: unknown, key: string, stack: Set<object>): string | undefined {
  if (value !== null && typeof value === "object") {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      value = (toJSON as (this: object, key: string) => unknown).call(value, key);
    }
  }

  if (value instanceof String || value instanceof Number || value instanceof Boolean) {
    value = value.valueOf();
  }

  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") throw new TypeError("BigInt values cannot be serialized as JSON");
  if (typeof value !== "object") return undefined;

  if (stack.has(value)) throw new TypeError("Converting circular structure to JSON");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        items.push(serialize(value[index], String(index), stack) ?? "null");
      }
      return `[${items.join(",")}]`;
    }

    const objectValue = value as Record<string, unknown>;
    const entries: string[] = [];
    for (const property of Object.keys(objectValue).sort()) {
      const serialized = serialize(objectValue[property], property, stack);
      if (serialized !== undefined) {
        entries.push(`${JSON.stringify(property)}:${serialized}`);
      }
    }
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}
