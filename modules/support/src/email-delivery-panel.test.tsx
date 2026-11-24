import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailDeliveryPanel } from "./email-delivery-panel";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("offers a labeled retry with ticket-scoped fields through the shared status form", () => {
  const html = renderToStaticMarkup(<EmailDeliveryPanel ticketId="ticket_a" deliveries={[
    { id: "delivery_a", event: "reply", status: "failed", attempts: 5, safe_error: "permanent" },
  ]} />);
  expect(html).toContain('aria-labelledby="email-delivery-heading"');
  expect(html).toContain('action="/api/support/tickets"');
  expect(html).toContain('name="op" value="retry_email"');
  expect(html).toContain('name="ticketId" value="ticket_a"');
  expect(html).toContain('name="deliveryId" value="delivery_a"');
  expect(html).toContain("Retry email");
  expect(html).toContain("focus-visible:ring-2");
});
it("does not offer retry for delivered or in-flight email", () => {
  for (const status of ["pending", "retry", "sending", "delivered"] as const) {
    const html = renderToStaticMarkup(<EmailDeliveryPanel ticketId="ticket_a" deliveries={[
      { id: "delivery_a", event: "created", status, attempts: 1, safe_error: null },
    ]} />);
    expect(html).not.toContain("Retry email");
    expect(html).toContain("Ticket confirmation");
  }
});
