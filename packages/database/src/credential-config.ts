const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function configuredKeys(env: Readonly<Record<string, string | undefined>>): {
  keys: string | Record<string, string>;
  activeKeyId: string;
} {
  const legacy = env.TENANT_DB_ENCRYPTION_KEY;
  const encoded = env.TENANT_DB_ENCRYPTION_KEYS;
  if (!encoded) {
    if (!legacy) throw new Error("Missing TENANT_DB_ENCRYPTION_KEY(S)");
    if (
      env.TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID &&
      env.TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID !== "k0"
    ) {
      throw new Error("Missing active encryption key ID");
    }
    return { keys: legacy, activeKeyId: "k0" };
  }
  const keys: Record<string, string> = Object.create(null);
  for (const entry of encoded.split(",")) {
    const parts = entry.trim().split(":");
    const [id, value] = parts;
    if (
      parts.length !== 2 ||
      !id ||
      !value ||
      !KEY_ID.test(id) ||
      Object.hasOwn(keys, id)
    ) {
      throw new Error("Invalid TENANT_DB_ENCRYPTION_KEYS entries");
    }
    keys[id] = value;
  }
  if (legacy) {
    if (keys.k0 !== undefined && keys.k0 !== legacy)
      throw new Error("Conflicting legacy encryption key");
    keys.k0 = legacy;
  }
  const active = env.TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID;
  if (!active) throw new Error("Missing TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID");
  return { keys, activeKeyId: active };
}

export function validateCredentialConfig(env: Readonly<Record<string, string | undefined>>): void {
  const { keys, activeKeyId } = configuredKeys(env);
  const entries = typeof keys === "string" ? [["k0", keys]] : Object.entries(keys);
  if (!entries.length || entries.some(([id, key]) => !KEY_ID.test(id!) || !/^[A-Za-z0-9+/]{43}=$/.test(key!)) || !entries.some(([id]) => id === activeKeyId)) throw new Error("Invalid encryption key configuration");
}
