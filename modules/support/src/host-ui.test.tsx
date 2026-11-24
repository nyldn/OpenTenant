import { afterEach, expect, it, vi } from "vitest";
import { submitTicketForm } from "./host-ui";

const action = "https://example.test/api/tickets";
const path = "/tickets/11111111-1111-4111-8111-111111111111";
const data = new FormData();
data.set("body", "Synthetic reply");
const fetchMock = vi.fn();
afterEach(() => vi.unstubAllGlobals());

it("accepts only the API's successful same-origin redirect and sends the original form", async () => {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValue({ ok: true, redirected: true, url: `https://example.test${path}` }));
  expect(await submitTicketForm(action, data, path)).toEqual({ status: "success", path });
  expect(fetchMock).toHaveBeenCalledWith(action, { method: "POST", body: data, credentials: "same-origin" });
});

it.each([true, false])("releases unread streamed response bodies after a mutation, ok=%s", async ok => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  vi.stubGlobal("fetch", fetchMock.mockResolvedValue({ ok, redirected: true, url: `https://example.test${path}`, body }));
  expect((await submitTicketForm(action, data, path)).status).toBe(ok ? "success" : "error");
  expect(cancel).toHaveBeenCalledOnce();
  expect(await body.getReader().read()).toEqual({ done: true, value: undefined });
});

it.each([
  { ok: false, redirected: true, url: `https://example.test${path}` },
  { ok: true, redirected: false, url: `https://example.test${path}` },
  { ok: true, redirected: true, url: `https://example.test${path}?error=input` },
  { ok: true, redirected: true, url: `https://other.example.test${path}` },
  { ok: true, redirected: true, url: "https://example.test/auth/login" },
])("rejects an unconfirmed mutation without reading private response content: %j", async response => {
  const text = vi.fn().mockResolvedValue("PRIVATE_DRIVER_DETAIL");
  vi.stubGlobal("fetch", fetchMock.mockResolvedValue({ ...response, text }));
  expect(await submitTicketForm(action, data, path)).toEqual({ status: "error", message: "We couldn't save your changes. Please try again." });
  expect(text).not.toHaveBeenCalled();
});

it("normalizes network errors into safe retry wording", async () => {
  vi.stubGlobal("fetch", fetchMock.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAIL")));
  expect(await submitTicketForm(action, data, path)).toEqual({ status: "error", message: "We couldn't save your changes. Please try again." });
});

it("validates a created ticket destination before navigation", async () => {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValue({ ok: true, redirected: true, url: `https://example.test${path}` }));
  expect(await submitTicketForm(action, data, "/tickets/", true)).toEqual({ status: "success", path });
  fetchMock.mockResolvedValue({ ok: true, redirected: true, url: "https://example.test/tickets/invalid" });
  expect((await submitTicketForm(action, data, "/tickets/", true)).status).toBe("error");
});
