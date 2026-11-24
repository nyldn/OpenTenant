import { describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query }), withControlPlaneTransaction: vi.fn() }));
import { ownerClaimJobStatus, ownerInviteUsable, ownerTokenHash } from "./tenant-owner-invite";

describe("owner bootstrap token policy", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const record = { expires_at: new Date(now.getTime() + 1000), revoked_at: null, consumed_at: null, email: "owner@example.test" };
  it("accepts an unexpired email-matched token", () => expect(ownerInviteUsable(record, "owner@example.test", now)).toBe(true));
  it("expires at the exact deadline", () => expect(ownerInviteUsable({ ...record, expires_at: now }, record.email, now)).toBe(false));
  it("rejects a consumed token", () => expect(ownerInviteUsable({ ...record, consumed_at: now }, record.email, now)).toBe(false));
  it("rejects a revoked token", () => expect(ownerInviteUsable({ ...record, revoked_at: now }, record.email, now)).toBe(false));
  it("rejects another authenticated email", () => expect(ownerInviteUsable(record, "other@example.test", now)).toBe(false));
  it("stores a digest instead of the raw capability", () => {
    expect(ownerTokenHash("synthetic-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(ownerTokenHash("synthetic-token")).not.toBe(ownerTokenHash("another-token"));
  });
});

it("refuses claim elevation from another active tenant before reading a token", async () => {
  const { claimTenantOwnerInvite } = await import("./tenant-owner-invite");
  await expect(claimTenantOwnerInvite("tenant_example", "x".repeat(43), { activeTenantId: "tenant_other", activeRole: "tenant_member", email: "owner@example.test" } as never)).rejects.toThrow("Tenant membership required");
});

it("looks up only owner-grant jobs belonging to the tenant and claimant", async () => {
  query.mockResolvedValueOnce({ rows: [{ status: "completed" }] });
  expect(await ownerClaimJobStatus("tenant_example", "usr_claimant" as never, "job_example")).toBe("completed");
  const [sql, values] = query.mock.calls.at(-1)!;
  expect(values).toEqual(["job_example", "tenant_example", "usr_claimant"]);
  expect(sql).toContain("j.id=$1");
  expect(sql).toContain("j.tenant_id=$2");
  expect(sql).toContain("j.kind='owner_grant'");
  expect(sql).toContain("i.tenant_id=$2");
  expect(sql).toContain("i.claimed_user_id=$3");
  query.mockResolvedValueOnce({ rows: [] });
  expect(await ownerClaimJobStatus("tenant_other", "usr_other" as never, "job_example")).toBeNull();
});
