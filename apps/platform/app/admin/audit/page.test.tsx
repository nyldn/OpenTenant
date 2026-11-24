import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listRecent: vi.fn().mockResolvedValue([]),
  verifyChain: vi.fn(),
  currentSession: vi.fn().mockResolvedValue({ isPlatformAdmin: true }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("../../../lib/audit", () => ({
  auditStore: () => ({
    listRecent: mocks.listRecent,
    verifyChain: mocks.verifyChain,
  }),
}));
vi.mock("../../../lib/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import AuditPage from "./page";

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

beforeEach(() => {
  mocks.listRecent.mockReset().mockResolvedValue([]);
  mocks.verifyChain.mockReset().mockResolvedValue({ intact: true, assurance: "empty" });
  mocks.currentSession.mockReset().mockResolvedValue({ isPlatformAdmin: true });
  mocks.redirect.mockClear();
});

it("applies exact tenant/action filters and inclusive UTC dates before the bounded read", async () => {
  const result = await AuditPage({ searchParams: Promise.resolve({ tenant: "tenant_alpha", action: "tenant.suspended", from: "2026-11-01", to: "2026-11-17" }) });
  expect(mocks.listRecent).toHaveBeenCalledWith(100, { tenantId: "tenant_alpha", action: "tenant.suspended", from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-18T00:00:00Z") });
  expect(textContent(result).replace(/\s+/g, " ")).toContain("0 matching events shown. Up to 100 newest matches.");
});

it("clears to the same bounded read and supports the platform scope", async () => {
  await AuditPage({});
  expect(mocks.listRecent).toHaveBeenLastCalledWith(100, {});
  await AuditPage({ searchParams: Promise.resolve({ tenant: "platform" }) });
  expect(mocks.listRecent).toHaveBeenLastCalledWith(100, { tenantId: null });
});

it.each([
  { from: "2026-02-30" }, { from: "bad" }, { to: "bad" },
  { from: "2026-11-17", to: "2026-11-01" }, { action: "a".repeat(129) },
])("rejects invalid filters without reading events: %j", async filters => {
  const result = await AuditPage({ searchParams: Promise.resolve(filters) });
  expect(textContent(result)).toContain("Enter valid filters");
  expect(mocks.listRecent).not.toHaveBeenCalled();
});

it("does not present a verified legacy-format prefix as canonical evidence", async () => {
  mocks.verifyChain.mockResolvedValue({
    intact: true,
    brokenAtSequence: null,
    assurance: "legacy-unbound",
    canonicalFromSequence: 3,
    failure: null,
  });

  const result = await AuditPage({});

  expect(textContent(result)).toContain("Platform chain verified with legacy-format prefix");
  expect(textContent(result)).not.toContain("Platform chain verified (canonical)");
});


it("denies non-admin access before reading privileged audit state", async () => {
  mocks.currentSession.mockResolvedValue({ isPlatformAdmin: false });
  const result = await AuditPage({});
  expect(result.type.name).toBe("AdminAccessDenied");
  expect(mocks.listRecent).not.toHaveBeenCalled();
  expect(mocks.verifyChain).not.toHaveBeenCalled();
});

it("keeps anonymous audit requests on the sign-in path", async () => {
  mocks.currentSession.mockResolvedValue(null);
  await expect(AuditPage({})).rejects.toThrow("NEXT_REDIRECT:/auth/login?return=/admin/audit");
  expect(mocks.listRecent).not.toHaveBeenCalled();
});
