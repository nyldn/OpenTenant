// Error projection is the page contract; real form behavior has browser proof.
vi.mock("@opentenant/design-system", () => ({ FormStatus: ({ children }: { children: React.ReactNode }) => <p role="alert">{children}</p> }));
vi.mock("../_components/settings-form", () => ({
  SettingsForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
  SettingsInput: () => <input />,
  SettingsSelect: ({ children }: { children: React.ReactNode }) => <select>{children}</select>,
}));
vi.mock("../../../lib/session", () => ({ currentSession: async () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
Object.assign(globalThis, { React });
vi.mock("../../../lib/identity", () => ({ identityGateway: () => ({ listTenantMembers: async () => [] }) }));
vi.mock("../../../lib/tenant-admin", () => ({ tenantAdminContext: async () => ({ ok: true, context: { tenant: { tenantId: "tenant_example", displayName: "Example" } } }) }));
import MembersPage from "./page";
it.each([
  ["invite", "Unable to complete the invitation. Check the members list before retrying."],
  ["email", "Enter a valid email address."],
  ["last_owner", "Keep at least one active tenant owner."],
  ["member", "Select a valid member."],
])("renders normalized %s form errors", async (error, message) => {
  const html = renderToStaticMarkup(await MembersPage({ searchParams: Promise.resolve({ error }) }));
  expect(html).toContain('role="alert"');
  expect(html).toContain(message);
});
it.each(["untrusted-provider-diagnostic", "__proto__"])("does not echo unknown error %s", async (error) => {
  const html = renderToStaticMarkup(await MembersPage({ searchParams: Promise.resolve({ error }) }));
  expect(html).not.toContain(error);
});
