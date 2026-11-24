import { expect, it, vi } from "vitest";
import { PgAuditStore } from "./audit-store";

it("binds filters before ordering and limiting, including a null platform scope", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const store = new PgAuditStore({ query } as never);
  const from = new Date("2026-11-01Z");
  const to = new Date("2026-11-18Z");
  await store.listRecent(100, { tenantId: null, action: "x' or true --", from, to });
  const [sql, params] = query.mock.calls[0]!;
  expect(sql).toContain("where tenant_id is not distinct from $1 and action = $2 and occurred_at >= $3 and occurred_at < $4");
  expect(sql).toContain("order by occurred_at desc, tenant_id, sequence desc limit $5");
  expect(sql).not.toContain("x' or true");
  expect(params).toEqual([null, "x' or true --", from, to, 100]);
});

it.each([[10000, 500], [0, 1], [NaN, 100]])("bounds an unfiltered read with limit %s", async (limit, bounded) => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  await new PgAuditStore({ query } as never).listRecent(limit);
  expect(query.mock.calls[0]![1]).toEqual([bounded]);
  expect(query.mock.calls[0]![0]).toContain("limit $1");
});
