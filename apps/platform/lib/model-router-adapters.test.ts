import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicChatAdapter, OpenAIChatAdapter, type ChatAdapterConfig } from "./model-router-adapters";

const secret = "synthetic-provider-secret";
const config = { baseUrl: "https://models.example.test/v1", model: "chat-snapshot-1", region: "eu", timeoutMs: 30, maxOutputTokens: 128 } as const;
const input = { model: config.model, region: config.region, input: "Synthetic prompt", credential: secret };
afterEach(() => vi.restoreAllMocks());

for (const kind of ["openai", "anthropic"] as const) describe(`${kind} chat conformance`, () => {
  const create = (fetcher: typeof fetch, overrides: Partial<ChatAdapterConfig> = {}) => kind === "openai"
    ? new OpenAIChatAdapter({ ...config, ...overrides, apiVersion: "v1" }, fetcher)
    : new AnthropicChatAdapter({ ...config, ...overrides, apiVersion: "2023-06-01" }, fetcher);
  const payload = () => kind === "openai"
    ? { model: config.model, choices: [{ message: { content: "Synthetic answer" }, finish_reason: "stop" }] }
    : { model: config.model, type: "message", content: [{ type: "text", text: "Synthetic answer" }], stop_reason: "end_turn" };
  const fixture = (body: unknown = payload(), status = 200) => vi.fn<typeof fetch>(async () => Response.json(body, { status }));

  it("uses the brokered credential and exact configured model/version", async () => {
    const fetcher = fixture();
    expect(await create(fetcher).complete(input)).toEqual({ output: "Synthetic answer" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${config.baseUrl}/${kind === "openai" ? "chat/completions" : "messages"}`);
    expect(init!.redirect).toBe("error");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: config.model, stream: false });
    const headers = new Headers(init!.headers);
    expect(headers.get(kind === "openai" ? "authorization" : "x-api-key")).toBe(kind === "openai" ? `Bearer ${secret}` : secret);
    if (kind === "anthropic") expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });
  it("implements the stream port with a cancellable buffered completion", async () => {
    const chunks: string[] = [];
    for await (const chunk of create(fixture()).stream({ ...input, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks).toEqual(["Synthetic answer"]);
  });
  it("times out and aborts the HTTP request", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { signal = init!.signal as AbortSignal; return new Promise(() => {}); });
    await expect(create(fetcher).complete(input)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
  });
  it("cancels in flight without exposing the abort reason", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => new Promise(() => {}));
    const pending = create(fetcher).complete({ ...input, signal: controller.signal });
    controller.abort(secret);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED", message: "Model provider request cancelled" });
  });
  it("keeps the timeout active while reading the response body", async () => {
    const response = new Response();
    vi.spyOn(response, "json").mockImplementation(async () => new Promise(() => {}));
    await expect(create(async () => response).complete(input)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("does not dispatch an already cancelled request", async () => {
    const fetcher = fixture(), controller = new AbortController(); controller.abort(secret);
    await expect(create(fetcher).complete({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500, 503])("maps HTTP %s without leaking response content", async status => {
    await expect(create(fixture({ error: secret }, status)).complete(input)).rejects.toMatchObject({ code: status < 500 ? "PROVIDER_REJECTED" : "PROVIDER_UNAVAILABLE" });
  });
  it("rejects mismatched models and regions before dispatch", async () => {
    const fetcher = fixture(), adapter = create(fetcher);
    await expect(adapter.complete({ ...input, model: "other" })).rejects.toMatchObject({ code: "MODEL_MISMATCH" });
    await expect(adapter.complete({ ...input, region: "us" })).rejects.toMatchObject({ code: "REGION_MISMATCH" });
    await expect(adapter.complete({ ...input, credential: undefined })).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates response model and shape", async () => {
    await expect(create(fixture({ ...payload(), model: "other" })).complete(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(create(fixture({ model: config.model })).complete(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects unsupported versions and unsafe endpoint configuration", () => {
    const Adapter = kind === "openai" ? OpenAIChatAdapter : AnthropicChatAdapter;
    expect(() => new Adapter({ ...config, apiVersion: "unsupported" } as never)).toThrow("Invalid model provider configuration");
    expect(() => create(fixture(), { baseUrl: `https://user:${secret}@models.example.test` })).toThrow("Invalid model provider configuration");
  });
  it("redacts provider, transport and JSON errors and emits no logs", async () => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    const fetchers = [fixture({ error: secret }, 500), vi.fn<typeof fetch>(async () => { throw new Error(secret); }), vi.fn<typeof fetch>(async () => new Response(secret))];
    for (const fetcher of fetchers) {
      const error = await create(fetcher).complete(input).catch(error => error);
      expect(String(error)).not.toContain(secret); expect(error.stack).not.toContain(secret); expect(error.cause).toBeUndefined();
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
