import { describe, expect, it, vi } from "vitest";
import { addCustomDomain, reissueCustomDomain, removeCustomDomain, verifyCustomDomain } from "./custom-domains";

function database(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: /select/.test(sql) ? rows : [], rowCount: 1 }));
  const client = { query, release: vi.fn() };
  return { client, pool: { connect: vi.fn(async () => client) } };
}
const actor = { kind: "user" as const, userId: "user_example" };
vi.mock("@opentenant/database", () => ({ PgAuditStore: class { async appendWithClient(client: ReturnType<typeof database>["client"], event: unknown) { await client.query("audit", [event]); } } }));
vi.mock("./server-config", () => ({ serverConfig: () => ({ OPENTENANT_TENANT_BASE_DOMAIN: "platform.test" }) }));

describe("custom domain store", () => {
  it("stores only a random challenge hash and commits the audit with the write", async () => {
    const { pool, client } = database();
    const first = await addCustomDomain("ten_alpha", "app.customer.test", actor, pool as never);
    const second = await addCustomDomain("ten_alpha", "app.other.test", actor, pool as never);
    expect(first.token).toMatch(/^opentenant-[a-f0-9]{64}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.record).toBe("_opentenant-challenge.app.customer.test");
    expect(JSON.stringify(client.query.mock.calls)).not.toContain(first.token);
    expect(client.query.mock.calls.some(([sql]) => sql === "audit")).toBe(true);
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("commit");
  });
  it("rejects another tenant's domain before writing", async () => {
    const { pool, client } = database([{ host: "app.customer.test" }]);
    await expect(addCustomDomain("ten_beta", "app.customer.test", actor, pool as never)).rejects.toThrow("Domain unavailable");
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("never removes a platform domain", async () => {
    const { pool, client } = database();
    await expect(removeCustomDomain("ten_alpha", "alpha.platform.test", actor, pool as never)).rejects.toThrow();
    expect(client.query.mock.calls.some(([sql]) => /delete from domains/.test(sql))).toBe(false);
  });
  it("uses injected DNS and fails closed when the resolver fails", async () => {
    const { pool, client } = database([{ challenge_hash: "a".repeat(64), challenge_expires_at: new Date(Date.now()+86400000), verified_at: new Date() }]);
    const resolver = vi.fn().mockRejectedValue(new Error("synthetic DNS failure"));
    expect(await verifyCustomDomain("ten_alpha", "app.customer.test", actor, resolver, pool as never)).toMatchObject({ active: false });
    expect(resolver).toHaveBeenCalledWith("_opentenant-challenge.app.customer.test");
    expect(client.query.mock.calls.some(([sql]) => /update domains/.test(sql))).toBe(true);
  });
});

it("reissues under a tenant row lock, clears previous evidence and audits before commit", async () => {
  const { pool, client } = database([{ host: "app.customer.test" }]);
  const result = await reissueCustomDomain("ten_alpha", "app.customer.test", actor, pool as never);
  expect(result.token).toMatch(/^opentenant-[a-f0-9]{64}$/);
  expect(JSON.stringify(client.query.mock.calls)).not.toContain(result.token);
  expect(client.query.mock.calls.some(([sql, values]) => /for update/.test(sql) && JSON.stringify(values) === JSON.stringify(["app.customer.test", "ten_alpha"]))).toBe(true);
  const update = client.query.mock.calls.find(([sql]) => /update domains/.test(sql))?.[0];
  expect(update).toMatch(/active = false/); expect(update).toMatch(/verified_at = null/); expect(update).toMatch(/next_check_at = null/);
  expect(JSON.stringify(client.query.mock.calls)).toContain("domain.challenge_reissued");
  expect(client.query.mock.calls.at(-1)?.[0]).toBe("commit");
});
it("rejects reissue for a domain outside the tenant", async () => {
  const { pool, client } = database();
  await expect(reissueCustomDomain("ten_beta", "app.customer.test", actor, pool as never)).rejects.toThrow("Domain unavailable");
  expect(client.query.mock.calls.some(([sql]) => /update domains/.test(sql))).toBe(false);
});
it("discards DNS answers started before a concurrent challenge rotation", async () => {
  const expires = new Date(Date.now() + 86_400_000);
  const { pool, client } = database([{ challenge_hash: "a".repeat(64), challenge_expires_at: expires, verified_at: null }]);
  const dns = vi.fn(async () => {
    client.query.mockImplementation(async sql => ({ rows: /select/.test(sql) ? [{ challenge_hash: "b".repeat(64), challenge_expires_at: expires, verified_at: null }] : [], rowCount: 1 }));
    return [["old-value"]];
  });
  await expect(verifyCustomDomain("ten_alpha", "app.customer.test", actor, dns, pool as never)).rejects.toThrow("Challenge changed");
  expect(client.query.mock.calls.some(([sql]) => /update domains/.test(sql))).toBe(false);
});
