import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenFgaClient } from "@openfga/sdk";
import { transformer } from "@openfga/syntax-transformer";
import { authorizationConformance, CONFORMANCE_MANIFEST, CONFORMANCE_REQUEST } from "../testing";
import { OpenFgaAuthorization } from "./adapters/openfga";
import { syncMembership } from "./sync";

const IMAGE = "openfga/openfga:v1.11.0@sha256:4ae8bb77ddc1a064a241f049d724971e7c2075b6792b3c477abf0409d899b61a";
const name = `opentenant-authz-${randomUUID()}`;
let apiUrl: string;
let model: ReturnType<typeof transformer.transformDSLToJSONObject>;
const stores: string[] = [];
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();

beforeAll(async () => {
  try {
    docker("run", "--rm", "-d", "--name", name, "-p", "127.0.0.1::8080", IMAGE, "run", "--datastore-engine", "memory", "--playground-enabled=false");
    const port = docker("port", name, "8080/tcp").split(":").at(-1);
    apiUrl = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { healthy = (await fetch(`${apiUrl}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* startup */ }
      if (healthy) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!healthy) throw new Error("OpenFGA failed readiness");
    model = transformer.transformDSLToJSONObject(await readFile(new URL("../model/authorization.fga", import.meta.url), "utf8"));
  } catch (error) {
    docker("rm", "-f", name);
    throw error;
  }
}, 60_000);
afterAll(() => { docker("rm", "-f", name); });

async function factory(options: import("./port").AuthorizationOptions): Promise<OpenFgaAuthorization> {
  const client = new OpenFgaClient({ apiUrl });
  const store = await client.createStore({ name: `conformance-${stores.length}` });
  stores.push(store.id!);
  client.storeId = store.id!;
  const written = await client.writeAuthorizationModel(model);
  return new OpenFgaAuthorization({ apiUrl, storeId: store.id!, authorizationModelId: written.authorization_model_id! }, options);
}
authorizationConformance("OpenFGA container", factory);

describe("OpenFGA real relationship graph", () => {
  const options = { loadContext: async () => ({ manifest: CONFORMANCE_MANIFEST, entitled: true, roles: ["tenant_admin" as const], claims: ["example.edit"] }) };
  it("keeps the same user isolated across two fully entitled tenants", async () => {
    const port = await factory(options);
    expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_admin" }, { kind: "entitlement", moduleKey: "example" }] })).toBe(true);
    expect(await port.writeRelationships({ tenantId: "ten_b", relationships: [{ kind: "membership", userId: "user_b", role: "tenant_admin" }, { kind: "entitlement", moduleKey: "example" }] })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use", "example.edit"]);
    expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, tenantId: "ten_b" })).toEqual([]);
    expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, userId: "user_b" })).toEqual([]);
    expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, tenantId: "ten_b", userId: "user_b" })).toEqual(["example.use", "example.edit"]);
  });
  it("replays membership sync and revokes before granting a changed role", async () => {
    const port = await factory(options);
    const input = { tenantId: "ten_a", userId: "user_a", role: "tenant_admin" as const, active: true };
    expect(await syncMembership(port, input)).toBe(true);
    expect(await syncMembership(port, input)).toBe(true);
    expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "entitlement", moduleKey: "example" }] })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toContain("example.edit");
    expect(await syncMembership(port, { ...input, role: "tenant_member" })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    expect(await syncMembership(port, { ...input, active: false })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
  });
  it("fails closed when the provider cannot be reached", async () => {
    const port = new OpenFgaAuthorization({ apiUrl: "http://127.0.0.1:1", storeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", authorizationModelId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, { ...options, timeoutMs: 100 });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_admin" }] })).toBe(false);
  });
});
