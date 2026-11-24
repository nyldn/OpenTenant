import { afterEach, describe, expect, it, vi } from "vitest";
import { hashChallenge } from "@opentenant/domains/verification";
import { CUSTOM_DOMAIN_BATCH_SIZE, CUSTOM_DOMAIN_CRONTAB, customDomainWorkerTasks, runCustomDomainRechecks, selectDueCustomDomains } from "./custom-domains-job";

const audit = vi.hoisted(() => vi.fn());
vi.mock("@opentenant/database", () => ({ PgAuditStore: class { appendWithClient = audit; } }));
const now = new Date("2030-01-02");
function database(count = 1) {
  const rows = Array.from({ length: count }, (_, index) => ({
    host: `app${index}.customer.test`, tenant_id: "ten_example", challenge_hash: hashChallenge("token"),
    challenge_record: `_opentenant-challenge.app${index}.customer.test`,
    challenge_expires_at: new Date("2030-01-01"), verification_valid_until: now,
  }));
  const query = vi.fn(async (sql: string, values?: unknown[]) => ({ rows: sql.startsWith("select host") ? rows.filter(row => row.host === values?.[1]) : [] }));
  const client = { query, release: vi.fn() };
  const pool = { query: vi.fn(async () => ({ rows })), connect: vi.fn(async () => client) };
  return { pool, client };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("bounded domain job", () => {
  it.each([1000, Infinity, NaN])("caps selector limit %s", async limit => {
    const { pool } = database();
    await selectDueCustomDomains(pool as never, now, limit);
    expect(pool.query.mock.calls[0]).toEqual([expect.stringContaining("limit $2"), [now, CUSTOM_DOMAIN_BATCH_SIZE]]);
  });
  it("stops waiting for a hung resolver, audits a safe reason, and releases the lock", async () => {
    vi.useFakeTimers();
    const { pool, client } = database();
    const work = runCustomDomainRechecks({ pool: pool as never, now: () => now, resolveTxt: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await work).toEqual({ selected: 1, checked: 1 });
    expect(audit.mock.calls[0][1]).toMatchObject({ action: "domain.reverification_checked", detail: { active: false, reason: "dns_unavailable" } });
    expect(client.query.mock.calls.at(-1)).toEqual(["commit"]);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("spaces checks within the batch and rolls back if audit fails", async () => {
    const { pool, client } = database(2);
    const stagger = vi.fn();
    expect(await runCustomDomainRechecks({ pool: pool as never, now: () => now, resolveTxt: async () => [["token"]], stagger })).toEqual({ selected: 2, checked: 2 });
    expect(stagger).toHaveBeenCalledExactlyOnceWith(100);
    audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(runCustomDomainRechecks({ pool: pool as never, now: () => now, resolveTxt: async () => [] })).rejects.toThrow("synthetic audit failure");
    expect(client.query.mock.calls.at(-1)).toEqual(["rollback"]);
  });
  it("exports the task named in the schedule", () => {
    expect(CUSTOM_DOMAIN_CRONTAB).toBe("* * * * * custom_domain_reverify ?max=5");
    expect(Object.keys(customDomainWorkerTasks)).toEqual(["custom_domain_reverify"]);
  });
});
