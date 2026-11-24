import { expect, it, vi } from "vitest";
import { listTicketEmailDeliveries } from "./delivery-store";
import type { SupportClient } from "./ticket-store";

it("keeps ticket reads available before the delivery migration is installed", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ installed: false }] });
  expect(await listTicketEmailDeliveries({ query } as SupportClient, "tenant_a", "ticket_a")).toEqual([]);
  expect(query).toHaveBeenCalledOnce();
});
it("does not hide a database outage as an empty delivery list", async () => {
  const failure = new Error("connection unavailable");
  const query = vi.fn().mockRejectedValue(failure);
  await expect(listTicketEmailDeliveries({ query } as SupportClient, "tenant_a", "ticket_a")).rejects.toBe(failure);
});
