import { describe, expect, it, vi } from "vitest";
import { EMAIL_MAX_ATTEMPTS, emailFailure, safeDeliveryError } from "./delivery-state";
import { supportEmailDeliveryTask } from "./delivery-worker";
import type { QueuedSupportEmail } from "./delivery-store";

const delivery = { id: "message", tenant_id: "tenant_a", ticket_number: "SUP-1", destination_ref: "directory:user", idempotency_key: "stable-key", event: "created", attempts: 1, lease_token: "lease" } as QueuedSupportEmail;
describe("durable email state machine", () => {
  it("backs off transient failures and terminates at the retry budget", () => {
    expect(Array.from({ length: 5 }, (_, i) => emailFailure(i + 1, "transient"))).toEqual([
      ...[30, 60, 120, 240].map(delaySeconds => ({ status: "retry", safeError: "transient", delaySeconds })),
      { status: "failed", safeError: "transient", delaySeconds: 480 },
    ]);
    expect(emailFailure(EMAIL_MAX_ATTEMPTS, "transient").status).toBe("failed");
  });
  it("terminates permanent failures and never stores arbitrary errors", () => {
    for (const error of ["permanent", "destination_unavailable"]) expect(emailFailure(1, error).status).toBe("failed");
    expect(safeDeliveryError(new Error("driver password"))).toBe("transient");
    expect(safeDeliveryError("recipient@example.test")).toBe("transient");
  });
  it("replays the same key after restart and records success without another claim", async () => {
    const claim = vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null);
    const settle = vi.fn().mockResolvedValue(true);
    const deliver = vi.fn().mockResolvedValue({ ok: true });
    await supportEmailDeliveryTask({ claim, ready: async () => true, settle }, { deliver })("tenant_a");
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "stable-key", tenantId: "tenant_a" }));
    expect(settle).toHaveBeenCalledWith(delivery, { ok: true });
  });
  it("does not send when a preference is revoked or the lease is lost", async () => {
    const deliver = vi.fn();
    const settle = vi.fn();
    const claim = vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null);
    await supportEmailDeliveryTask({ claim, ready: async () => false, settle }, { deliver })("tenant_a");
    expect(deliver).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(delivery, { ok: false, safeErrorClass: "destination_unavailable" });
  });
  it("normalizes thrown transport errors and refuses a cross-tenant claim", async () => {
    const settle = vi.fn();
    const claim = vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null);
    await supportEmailDeliveryTask({ claim, ready: async () => true, settle }, {
      deliver: async () => { throw Error("driver secret"); },
    })("tenant_a");
    expect(settle).toHaveBeenCalledWith(delivery, { ok: false, safeErrorClass: "transient" });
    await expect(supportEmailDeliveryTask({ claim: async () => delivery, ready: vi.fn(), settle }, { deliver: vi.fn() })("tenant_b")).rejects.toThrow("tenant mismatch");
  });
  it("preserves the transport key across SMTP acceptance followed by a lost database receipt", async () => {
    const claim = vi.fn().mockResolvedValueOnce(delivery).mockResolvedValueOnce({ ...delivery, attempts: 2, lease_token: "new-lease" }).mockResolvedValue(null);
    const settle = vi.fn().mockRejectedValueOnce(Error("receipt unavailable")).mockResolvedValue(true);
    const deliver = vi.fn().mockResolvedValue({ ok: true });
    const store = { claim, ready: async () => true, settle };
    await expect(supportEmailDeliveryTask(store, { deliver })("tenant_a")).rejects.toThrow("receipt unavailable");
    await supportEmailDeliveryTask(store, { deliver })("tenant_a");
    // SMTP may accept both messages, but their stable Message-ID key is identical.
    expect(deliver.mock.calls.map(call => call[0].idempotencyKey)).toEqual(["stable-key", "stable-key"]);
  });

});
