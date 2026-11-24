import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PgSupportSessionStore } from "./support-session-store";

describe("PgSupportSessionStore", () => {
  it("creates an opaque session bound to the database installation identity", async () => {
    const query = vi.fn().mockImplementation(async (_sql: string, values: unknown[]) => ({
      rows: [{
        session_id: values[0],
        token_hash: values[1],
        installation_id: "ins_database",
        tenant_id: "ten_example",
        operator_user_id: "usr_operator",
        reason: "Repair approved tenant configuration",
        reference: null,
        allowed_action_classes: ["routine_configuration"],
        created_at: new Date("2026-07-22T10:00:00Z"),
        last_activity_at: new Date("2026-07-22T10:00:00Z"),
        expires_at: new Date("2026-07-22T10:30:00Z"),
        revoked_at: null,
      }],
    }));
    const store = new PgSupportSessionStore({ query } as unknown as Pool);

    const created = await store.create({
      tenantId: "ten_example",
      operatorUserId: "usr_operator",
      reason: "Repair approved tenant configuration",
      reference: null,
      allowedActionClasses: ["routine_configuration"],
      expiresAt: new Date("2026-07-22T10:30:00Z"),
    });

    expect(created?.session.installationId).toBe("ins_database");
    expect(created?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from installation_metadata installation");
    expect(values).not.toContain(created?.token);
    expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires the current singleton installation when resolving and revoking", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PgSupportSessionStore({ query } as unknown as Pool);

    await store.findActive("opaque-token");
    await store.revoke("opaque-token", "usr_operator");

    expect(query.mock.calls[0]?.[0]).toContain("installation_id = (select installation_id from installation_metadata");
    expect(query.mock.calls[1]?.[0]).toContain("installation_id = (select installation_id from installation_metadata");
  });
});
