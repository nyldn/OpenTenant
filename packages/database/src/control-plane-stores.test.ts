import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { MembershipId, TenantId, UserId } from "@opentenant/auth";
import { PgAccountLinkStore, PgTenantOrgResolver } from "./control-plane-stores";

interface MembershipRow {
  membership_id: string;
  tenant_id: string | null;
  user_id: string | null;
}

class MembershipPool {
  readonly queries: string[] = [];

  constructor(private row: MembershipRow | null) {}

  async query(sql: string, params: unknown[] = []): Promise<{ rows: MembershipRow[] }> {
    this.queries.push(sql);
    if (sql.startsWith("select membership_id")) {
      return { rows: this.row === null ? [] : [{ ...this.row }] };
    }
    if (sql.startsWith("update membership_links")) {
      if (this.row !== null) {
        this.row.tenant_id ??= params[1] as string;
        this.row.user_id ??= (params[2] as string | null);
      }
      return { rows: [] };
    }
    if (sql.startsWith("insert into membership_links")) {
      const candidate: MembershipRow = {
        membership_id: params[0] as string,
        tenant_id: params[4] as string,
        user_id: params[5] as string | null,
      };
      if (this.row === null) {
        this.row = candidate;
        return { rows: [{ ...candidate }] };
      }
      const tenantMatches =
        this.row.tenant_id === null || this.row.tenant_id === candidate.tenant_id;
      const userMatches =
        candidate.user_id === null ||
        this.row.user_id === null ||
        this.row.user_id === candidate.user_id;
      if (!tenantMatches || !userMatches) return { rows: [] };
      this.row.tenant_id ??= candidate.tenant_id;
      this.row.user_id ??= candidate.user_id;
      return { rows: [{ ...this.row }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }

  asPool(): Pool {
    return { query: this.query.bind(this) } as unknown as Pool;
  }

  snapshot(): MembershipRow | null {
    return this.row === null ? null : { ...this.row };
  }
}

const ref = { kind: "membership" as const, externalId: "membership_example" };
const tenantId = "tenant_example" as TenantId;
const userId = "user_example" as UserId;

describe("provider-scoped identity stores", () => {
  it("isolates identical external organization references by provider", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const workos = new PgTenantOrgResolver(pool, "workos");
    const clerk = new PgTenantOrgResolver(pool, "clerk");

    await workos.tenantForExternalOrganization("external_same");
    await clerk.tenantForExternalOrganization("external_same");

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("provider = $1"),
      ["workos", "external_same"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("provider = $1"),
      ["clerk", "external_same"],
    );
  });

  it("isolates identical account and membership references by provider", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const workos = new PgAccountLinkStore(pool, "workos");
    const clerk = new PgAccountLinkStore(pool, "clerk");

    await workos.externalSubjectForUserId(userId);
    await clerk.externalSubjectForUserId(userId);
    await workos.externalRefForMembershipId("mem_same" as MembershipId);
    await clerk.externalRefForMembershipId("mem_same" as MembershipId);

    expect(query.mock.calls.map(([, params]) => params)).toEqual([
      ["workos", userId],
      ["clerk", userId],
      ["workos", "mem_same"],
      ["clerk", "mem_same"],
    ]);
  });

  it("returns the stored tenant and user ownership with a membership reference", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        external_kind: "membership",
        external_id: "external_membership",
        tenant_id: tenantId,
        user_id: userId,
      }],
    });
    const store = new PgAccountLinkStore({ query } as unknown as Pool, "clerk");

    await expect(
      store.externalRefForMembershipId("mem_internal" as MembershipId),
    ).resolves.toEqual({
      kind: "membership",
      externalId: "external_membership",
      tenantId,
      userId,
    });
  });

  it("replaces an invitation reference only when the provider and old reference match", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PgAccountLinkStore({ query } as unknown as Pool, "workos");

    await store.replaceExternalRefForMembershipId(
      "mem_internal" as MembershipId,
      { kind: "invitation", externalId: "invitation_old" },
      { kind: "invitation", externalId: "invitation_new" },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("external_kind = $3 and external_id = $4"),
      ["invitation_new", "workos", "invitation", "invitation_old", "mem_internal"],
    );
  });
});

describe("PgAccountLinkStore membership ownership", () => {
  it("returns an existing membership when tenant and user ownership match", async () => {
    const fake = new MembershipPool({
      membership_id: "mem_example",
      tenant_id: tenantId,
      user_id: userId,
    });
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(ref, { tenantId, userId })).resolves.toBe("mem_example");
  });

  it("enriches ownership that was previously unknown", async () => {
    const fake = new MembershipPool({
      membership_id: "mem_example",
      tenant_id: null,
      user_id: null,
    });
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(ref, { tenantId, userId })).resolves.toBe("mem_example");
    expect(fake.snapshot()).toEqual({
      membership_id: "mem_example",
      tenant_id: tenantId,
      user_id: userId,
    });
  });

  it("rejects an existing membership owned by another tenant", async () => {
    const fake = new MembershipPool({
      membership_id: "mem_example",
      tenant_id: "tenant_other",
      user_id: userId,
    });
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(ref, { tenantId, userId }))
      .rejects.toThrow("membership ownership conflict");
    expect(fake.snapshot()).toEqual({
      membership_id: "mem_example",
      tenant_id: "tenant_other",
      user_id: userId,
    });
  });

  it("rejects an existing membership owned by another user", async () => {
    const fake = new MembershipPool({
      membership_id: "mem_example",
      tenant_id: tenantId,
      user_id: "user_other",
    });
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(ref, { tenantId, userId }))
      .rejects.toThrow("membership ownership conflict");
    expect(fake.snapshot()).toEqual({
      membership_id: "mem_example",
      tenant_id: tenantId,
      user_id: "user_other",
    });
  });

  it("rejects a membership reference without a user owner", async () => {
    const fake = new MembershipPool(null);
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(ref, { tenantId, userId: null }))
      .rejects.toThrow("membership ownership conflict");
    expect(fake.queries).toEqual([]);
  });

  it("allows an invitation reference to remain unowned until acceptance", async () => {
    const fake = new MembershipPool(null);
    const store = new PgAccountLinkStore(fake.asPool(), "workos");

    await expect(store.membershipIdForExternalRef(
      { kind: "invitation", externalId: "invitation_example" },
      { tenantId, userId: null },
    )).resolves.toMatch(/^mem_/u);
    expect(fake.snapshot()).toMatchObject({ tenant_id: tenantId, user_id: null });
  });
});

describe("account mapping inside a caller-owned transaction", () => {
  it("creates a new identity on the locked client without a checkout, commit or release", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: "user_winner" }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn(() => { throw new Error("nested checkout"); });
    const client = { query, release, connect } as unknown as import("pg").PoolClient;
    const store = new PgAccountLinkStore(client, "workos");
    await expect(store.userIdForExternalSubject("subject_example", "member@example.test", null)).resolves.toBe("user_winner");
    expect(connect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("commit");
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("begin");
    expect(query.mock.calls[4]?.[0]).toContain("delete from platform_users");
  });

  it("leaves rollback to the outer lock on mapping failure", async () => {
    const error = new Error("mapping unavailable");
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(error);
    const release = vi.fn();
    const client = { query, release } as unknown as import("pg").PoolClient;
    await expect(new PgAccountLinkStore(client, "clerk").userIdForExternalSubject("subject_example", "member@example.test", null)).rejects.toBe(error);
    expect(release).not.toHaveBeenCalled();
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("rollback");
  });
});
