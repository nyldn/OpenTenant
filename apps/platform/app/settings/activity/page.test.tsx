// Page tests assert the shared state contract. Browser specs exercise the DS.
vi.mock("@opentenant/design-system", () => ({
  EmptyState: ({ heading, description, action }: { heading: string; description: string; action: { href: string; label: string } }) => <section><h1>{heading}</h1><p>{description}</p><a href={action.href}>{action.label}</a></section>,
  AccessDenied: ({ state, description, action }: { state: string; description: string; action: { href: string; label: string } }) => <section role="alert"><h1>{state === "signed-out" ? "Sign in to continue" : "Access denied"}</h1><p>{description}</p><a href={action.href}>{action.label}</a></section>,
}));
vi.mock("../../../lib/session", () => ({ currentSession: async () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({ loadTenantActivity: vi.fn() }));
vi.mock("../../../lib/tenant-activity", () => ({ loadTenantActivity: mocks.loadTenantActivity }));

import ActivitySettingsPage from "./page";

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function elements(value: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  return [element, ...elements(element.props?.children)];
}

describe("ActivitySettingsPage", () => {
  beforeEach(() => {
    mocks.loadTenantActivity.mockReset();
  });

  it("renders an actionable empty recent-activity state", async () => {
    mocks.loadTenantActivity.mockResolvedValue({
      status: "ready",
      tenantName: "Example Organisation",
      records: [],
    });

    const result = await ActivitySettingsPage();
    const text = renderToStaticMarkup(result);

    expect(text).toContain("Recent activity");
    expect(text).toContain("No recent activity to show");
    expect(text).toContain("Try again later");
    expect(text).not.toMatch(/complete|compliance log|billing record/i);
  });

  it("renders a semantic newest-first timeline using only projected fields", async () => {
    mocks.loadTenantActivity.mockResolvedValue({
      status: "ready",
      tenantName: "Example Organisation",
      records: [
        {
          sequence: 12,
          occurredAt: "2026-08-06T12:00:00.000Z",
          actor: "Tenant user",
          action: "member.invited",
          subject: "membership:invited",
          summary: "Member invited",
          metadata: { role: "tenant_admin" },
        },
        {
          sequence: 9,
          occurredAt: "2026-08-05T09:30:00.000Z",
          actor: "System",
          action: "tenant.provisioned",
          subject: "tenant:verified",
          summary: "Tenant provisioned",
          metadata: {},
        },
      ],
    });

    const result = await ActivitySettingsPage();
    const tree = elements(result);
    const text = textContent(result);
    const list = tree.find((element) => element.type === "ol");
    const times = tree.filter((element) => element.type === "time");

    expect(tree.some((element) => element.type === "h1" && textContent(element) === "Recent activity")).toBe(true);
    expect(list).toBeDefined();
    expect(tree.filter((element) => element.type === "li")).toHaveLength(2);
    expect(times.map((element) => element.props?.dateTime)).toEqual([
      "2026-08-06T12:00:00.000Z",
      "2026-08-05T09:30:00.000Z",
    ]);
    expect(text.indexOf("Member invited")).toBeLessThan(text.indexOf("Tenant provisioned"));
    expect(text).toContain("Tenant user");
    expect(text).toContain("System");
  });

  it("renders only the projected display fields and never projected metadata or accidental extra fields", async () => {
    mocks.loadTenantActivity.mockResolvedValue({
      status: "ready",
      tenantName: "Example Organisation",
      records: [{
        sequence: 4,
        occurredAt: "2026-08-06T10:00:00.000Z",
        actor: "Tenant user",
        action: "member.invited",
        subject: "membership:invited",
        summary: "Member invited",
        metadata: { role: "tenant_member", secret: "metadata-secret" },
        rawDetail: { providerId: "provider-123", url: "https://private.example.test/callback" },
      }],
    } as never);

    const result = await (ActivitySettingsPage as (...requestValues: unknown[]) => ReturnType<typeof ActivitySettingsPage>)({
      searchParams: Promise.resolve({ tenantId: "ten_other" }),
      hostileFixture: {
        secret: "secret-value",
        providerId: "provider-123",
        url: "https://private.example.test/callback",
        hiddenAction: "provider.connected",
        otherTenantSubject: "tenant:other",
      },
    });
    const text = textContent(result);

    expect(mocks.loadTenantActivity).toHaveBeenCalledExactlyOnceWith();
    expect(text).toContain("Member invited");
    expect(text).not.toMatch(
      /secret-value|metadata-secret|provider-123|private\.example\.test|provider\.connected|tenant:other|ten_other/,
    );
  });

  it("renders an actionable tenant-invariant unavailable state", async () => {
    mocks.loadTenantActivity.mockResolvedValue({ status: "unavailable" });

    const text = renderToStaticMarkup(await ActivitySettingsPage());

    expect(text).toContain("Activity is temporarily unavailable");
    expect(text).toContain("Try again later");
    expect(text).not.toMatch(/another tenant|events exist|database/i);
  });

  it.each(["anonymous", "forbidden", "no_tenant"])("renders an announced, actionable %s denial", async (reason) => {
    mocks.loadTenantActivity.mockResolvedValue({ status: "denied", reason });
    const html = renderToStaticMarkup(await ActivitySettingsPage());
    expect(html).toContain('role="alert"');
    expect(html).toContain(reason === "anonymous" ? "Sign in to continue" : "Access denied");
    expect(html).toContain(reason === "anonymous" ? "/auth/login?return=/settings" : 'href="/"');
  });
});
