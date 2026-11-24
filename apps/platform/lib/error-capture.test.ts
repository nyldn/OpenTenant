import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ init: vi.fn(), captureEvent: vi.fn() }));
vi.mock("@sentry/nextjs", () => mocks);
import { startErrorCapture, captureServerError } from "./error-capture";
describe("Sentry-protocol adapter privacy", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("disables PII, logs, integrations and tracing, and scrubs before sending", async () => {
    await startErrorCapture("http://public@127.0.0.1/1");
    const options = mocks.init.mock.calls[0]![0];
    expect(options).toMatchObject({ sendDefaultPii: false, defaultIntegrations: false, tracesSampleRate: 0, enableLogs: false, enableOpenTelemetrySetup: false, sendClientReports: false });
    expect(options.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false });
    expect(options.beforeSend({ message: "private", user: { email: "private" }, request: { headers: { authorization: "private" } } })).toEqual({ level: "error", message: "Platform operation failed" });
    expect(options.beforeSendLog({ body: "private" })).toBeNull();
    expect(options.beforeBreadcrumb({ message: "private" })).toBeNull();
    await captureServerError();
    expect(mocks.captureEvent).toHaveBeenCalledWith({ level: "error", message: "Platform operation failed" });
  });
  it("rejects malformed DSNs before loading or invoking the SDK", async () => {
    await expect(startErrorCapture("invalid-private-value")).rejects.toThrow("Invalid error capture configuration");
    expect(mocks.init).not.toHaveBeenCalled();
  });
  it("accepts a self-hosted endpoint with a reverse-proxy path prefix", async () => {
    await startErrorCapture("https://public@errors.example.test/glitchtip/1");
    expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://public@errors.example.test/glitchtip/1" }));
  });
});
