import { AccessDenied } from "@opentenant/design-system";
import { beforeEach, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportPage } from "./host-page";
import { createTicketPage } from "./host-ticket";

const { gate, getTicket, listTickets } = vi.hoisted(() => ({ gate: vi.fn(), getTicket: vi.fn(), listTickets: vi.fn() }));
vi.mock("./host-context", () => ({ createSupportContext: () => gate }));
vi.mock("./index", () => ({ getTicket, listTickets, listDeadOutboxEvents: vi.fn().mockResolvedValue([]), TICKET_CATEGORIES: ["other"], TICKET_STATUSES: ["open"], TICKET_PRIORITIES: ["medium"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("not found"); }, redirect: (path: string) => { throw new Error(`redirect ${path}`); } }));
vi.mock("next/link", () => ({ default: "a" }));

const withTenantDb = vi.fn(async (_tenant: string, read: (client: unknown) => unknown) => read({}));
const host = { withTenantDb } as unknown as ModuleHostServices;
const id = "11111111-1111-4111-8111-111111111111";
const capabilities = { readOwn: true, replyOwn: true, readTenant: false, noteInternal: false };
beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ ok: true, context: { session: { userId: "requester" }, tenantId: "tenant_example", tenantDisplayName: "Example", capabilities } });
  listTickets.mockResolvedValue([]);
});

for (const page of ["list", "ticket"]) {
  it(`${page} denies access with a heading, explanation and exit before reading data`, async () => {
    gate.mockResolvedValue({ ok: false, reason: "forbidden" });
    const view = page === "list" ? await createSupportPage(host)() : await createTicketPage(host)({ params: Promise.resolve({ id }) });
    expect(view.type).toBe("main");
    expect(view.props.children.type).toBe(AccessDenied);
    expect(view.props.children.props).toEqual({ state: "forbidden", action: { label: "Go home", href: "/" } });
    expect(withTenantDb).not.toHaveBeenCalled();
  });
}

it("keeps requester ticket reads tenant-bound and excludes internal messages and history", async () => {
  getTicket.mockResolvedValue({ ticket: { id, createdBy: "requester", subject: "Example", description: "Description", ticketNumber: "SUP-1", status: "open", priority: "medium" },
    messages: [{ id: "private", messageType: "internal_note", body: "PRIVATE_NOTE", createdAt: new Date() }],
    events: [{ id: "private_event", kind: "internal_note", createdAt: new Date() }] });
  const view = await createTicketPage(host)({ params: Promise.resolve({ id }) });
  const html = JSON.stringify(view);
  expect(withTenantDb).toHaveBeenCalledWith("tenant_example", expect.any(Function));
  expect(getTicket).toHaveBeenCalledWith({}, "tenant_example", id);
  expect(html).not.toContain("PRIVATE_NOTE");
  const history = view.props.children.find((child: { type?: unknown } | null) => child?.type === "details");
  expect(history.props.children[0].props.children).toEqual(["History (", 0, ")"]);
});

it("preserves not-found semantics for another requester's ticket", async () => {
  getTicket.mockResolvedValue({ ticket: { createdBy: "someone_else" } });
  await expect(createTicketPage(host)({ params: Promise.resolve({ id }) })).rejects.toThrow("not found");
});

it("renders the empty-queue state when the tenant has no tickets", async () => {
  listTickets.mockResolvedValue([]);
  const html = JSON.stringify(await createSupportPage(host)());
  expect(listTickets).toHaveBeenCalled();
  expect(html).toContain("No tickets available.");
});
