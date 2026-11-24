import { describe, expect, it, vi } from "vitest";
import { defineModules } from "@opentenant/module-sdk";
import { seedModuleCatalog } from "./module-registry";

const manifest = { key: "example", version: "1.0.0", runtime: "native" as const, navigation: [], permissions: ["example.use"], rolePermissions: { tenant_member: ["example.use"] } };
const registry = defineModules([{ manifest, routes: [], adminPages: [], settingsPanels: [], migrations: { controlPlane: [], tenant: [] }, permissions: { declared: manifest.permissions, roles: manifest.rolePermissions }, catalog: { displayName: "Example", enabledByDefault: false } }]);

describe("catalog publication hook", () => {
  it("publishes the persisted snapshot on the same transaction client after its version", async () => {
    const persisted = { ...manifest, permissions: [], rolePermissions: {} };
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ authorization_manifest: persisted }] }).mockResolvedValue({ rows: [] });
    const client = { query };
    const publish = vi.fn(async (transaction, snapshot) => {
      expect(transaction).toBe(client);
      expect(snapshot).toEqual(persisted);
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining("insert into module_versions"), [manifest.key, manifest.version]);
    });
    await seedModuleCatalog(registry, client, publish);
    expect(publish).toHaveBeenCalledOnce();
  });
  it("does not publish an installed snapshot over an existing catalog restriction", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const publish = vi.fn();
    await seedModuleCatalog(registry, client, publish);
    expect(publish).not.toHaveBeenCalled();
  });
  it("preserves clients that deliberately discard query results", async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    await expect(seedModuleCatalog(registry, client)).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  it("preserves the optional-provider default without extra queries", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ authorization_manifest: manifest }] }) };
    await seedModuleCatalog(registry, client);
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
