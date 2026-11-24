import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ node: vi.fn(), components: vi.fn(() => ({})), vercel: vi.fn(), capture: vi.fn(), captureError: vi.fn() }));
vi.mock("@opentenant/observability/node", () => ({ startNodeTracing: mocks.node, tracingComponents: mocks.components }));
vi.mock("@vercel/otel", () => ({ registerOTel: mocks.vercel }));
vi.mock("./lib/error-capture", () => ({ startErrorCapture: mocks.capture, captureServerError: mocks.captureError }));
import { register, onRequestError } from "./instrumentation";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("opt-in observability startup", () => {
  it("loads no SDK or exporter when endpoints are unset", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("OPENTENANT_OTLP_ENDPOINT", ""); vi.stubEnv("SENTRY_DSN", "");
    await register(); await onRequestError();
    expect(mocks.node).not.toHaveBeenCalled(); expect(mocks.vercel).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.captureError).not.toHaveBeenCalled();
  });
  it("chooses the vendor-neutral Node SDK off Vercel", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("VERCEL", ""); vi.stubEnv("OPENTENANT_OTLP_ENDPOINT", "http://127.0.0.1:4318/v1/traces");
    await register(); expect(mocks.node).toHaveBeenCalledWith("http://127.0.0.1:4318/v1/traces"); expect(mocks.vercel).not.toHaveBeenCalled();
  });
  it("uses Vercel's adapter only on Vercel with an explicit endpoint", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("VERCEL", "1"); vi.stubEnv("OPENTENANT_OTLP_ENDPOINT", "http://127.0.0.1:4318/v1/traces");
    await register(); expect(mocks.vercel).toHaveBeenCalledOnce(); expect(mocks.node).not.toHaveBeenCalled();
  });
  it("supports an operator's self-hosted Sentry protocol endpoint", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("SENTRY_DSN", "http://public@127.0.0.1/1");
    await register(); await onRequestError(); expect(mocks.capture).toHaveBeenCalledWith("http://public@127.0.0.1/1"); expect(mocks.captureError).toHaveBeenCalledWith();
  });
  it("does not load Node adapters in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge"); await register(); await onRequestError(); expect(mocks.node).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
  });
});
