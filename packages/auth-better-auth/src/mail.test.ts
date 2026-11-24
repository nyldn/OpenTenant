import { expect, it, vi } from "vitest";
import { betterAuthMailHooks } from "./mail";
it("keeps mail off until configured and sends verification and invite through EmailTransport", async () => {
  expect(betterAuthMailHooks(undefined, "https://example.test")).toEqual({});
  const send = vi.fn().mockResolvedValue({ ok: true });
  const hooks = betterAuthMailHooks({ send }, "https://example.test");
  await hooks.sendVerificationEmail!({ email: "user@example.test", url: "https://example.test/verify?token=synthetic" });
  await hooks.sendInvitationEmail!({ email: "user@example.test", invitationId: "inv_synthetic", organizationId: "org_synthetic" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![0].text).toContain("invitation=inv_synthetic");
  send.mockResolvedValue({ ok: false, reason: "transient" });
  await expect(hooks.sendVerificationEmail!({ email: "user@example.test", url: "https://example.test/verify" })).rejects.toThrow("Identity email delivery failed");
});
it("preserves the separate owner-claim destination on the tenant-host invitation", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  const hooks = betterAuthMailHooks({ send }, "https://example.test", async () => "https://tenant.example.test", "/admin/tenants/tenant_example/owner-claim");
  await hooks.sendInvitationEmail!({ email: "owner@example.test", invitationId: "inv_synthetic", organizationId: "org_synthetic" });
  const url = new URL(send.mock.calls[0]![0].text.split("\n")[1]);
  expect(url.origin).toBe("https://tenant.example.test");
  expect(url.searchParams.get("return")).toBe("/admin/tenants/tenant_example/owner-claim");
  expect(url.searchParams.has("token")).toBe(false);
});
