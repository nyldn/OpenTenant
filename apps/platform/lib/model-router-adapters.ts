import type { DataRegion, SyntheticModelAdapter } from "@opentenant/platform-core";

/** Endpoint residency is an operator assertion, checked against resolved policy. */
export interface ChatAdapterConfig {
  baseUrl: string;
  model: string;
  region: DataRegion;
  timeoutMs: number;
  maxOutputTokens: number;
}
export interface OpenAIChatConfig extends ChatAdapterConfig { apiVersion: "v1" }
export interface AnthropicChatConfig extends ChatAdapterConfig { apiVersion: "2023-06-01" }
export type ModelProviderErrorCode = "INVALID_CONFIG" | "MODEL_MISMATCH" | "REGION_MISMATCH" | "CREDENTIAL_UNAVAILABLE"
  | "TIMEOUT" | "CANCELLED" | "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE";
const messages: Record<ModelProviderErrorCode, string> = {
  INVALID_CONFIG: "Invalid model provider configuration", MODEL_MISMATCH: "Model provider model mismatch",
  REGION_MISMATCH: "Model provider region mismatch", CREDENTIAL_UNAVAILABLE: "Model provider credential unavailable",
  TIMEOUT: "Model provider request timed out", CANCELLED: "Model provider request cancelled",
  PROVIDER_REJECTED: "Model provider rejected the request", PROVIDER_UNAVAILABLE: "Model provider unavailable",
  INVALID_RESPONSE: "Invalid model provider response",
};
/** Fixed messages only. Never attach the provider's body, error, URL or cause. */
export class ModelProviderError extends Error {
  constructor(readonly code: ModelProviderErrorCode) { super(messages[code]); this.name = "ModelProviderError"; }
}
type ChatInput = Parameters<SyntheticModelAdapter["complete"]>[0] & { signal?: AbortSignal };
function endpoint(config: ChatAdapterConfig, version: string, expected: string, path: string): string {
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || version !== expected || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model)
      || !["us", "eu", "ap"].includes(config.region)
      || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 300_000
      || !Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 65_536) throw new Error();
    return `${url.href.replace(/\/$/, "")}/${path}`;
  } catch { throw new ModelProviderError("INVALID_CONFIG"); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ModelProviderError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function outputText(body: unknown, model: string, provider: "openai" | "anthropic"): string {
  const response = record(body);
  if (response.model !== model) throw new ModelProviderError("INVALID_RESPONSE");
  let output: unknown;
  if (provider === "openai") {
    if (!Array.isArray(response.choices) || response.choices.length !== 1) throw new ModelProviderError("INVALID_RESPONSE");
    const choice = record(response.choices[0]);
    if (choice.finish_reason !== "stop") throw new ModelProviderError("INVALID_RESPONSE");
    output = record(choice.message).content;
  } else {
    if (response.type !== "message" || response.stop_reason !== "end_turn" || !Array.isArray(response.content)
      || response.content.length === 0) throw new ModelProviderError("INVALID_RESPONSE");
    output = response.content.map(block => {
      const part = record(block);
      if (part.type !== "text" || typeof part.text !== "string") throw new ModelProviderError("INVALID_RESPONSE");
      return part.text;
    }).join("");
  }
  if (typeof output !== "string" || output.length === 0) throw new ModelProviderError("INVALID_RESPONSE");
  return output;
}

/** Uses only the router's brokered credential, never ambient SDK configuration. */
class HostedChatAdapter implements SyntheticModelAdapter {
  readonly regions: readonly DataRegion[];
  private readonly url: string;
  private readonly config: Readonly<ChatAdapterConfig>;
  constructor(readonly provider: "openai" | "anthropic", config: ChatAdapterConfig, version: string, private readonly fetcher: typeof fetch) {
    this.url = endpoint(config, version, provider === "openai" ? "v1" : "2023-06-01", provider === "openai" ? "chat/completions" : "messages");
    this.config = Object.freeze({ ...config });
    this.regions = Object.freeze([config.region]);
  }
  async complete(input: ChatInput): Promise<{ output: string }> {
    if (input.model !== this.config.model) throw new ModelProviderError("MODEL_MISMATCH");
    if (input.region !== this.config.region) throw new ModelProviderError("REGION_MISMATCH");
    if (!input.credential?.trim() || /[\r\n]/.test(input.credential)) throw new ModelProviderError("CREDENTIAL_UNAVAILABLE");
    if (input.signal?.aborted) throw new ModelProviderError("CANCELLED");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    input.signal?.addEventListener("abort", cancel, { once: true });
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new ModelProviderError(timedOut ? "TIMEOUT" : "CANCELLED"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const result = await Promise.race([this.request(input, controller.signal), aborted]);
      return { output: outputText(result, this.config.model, this.provider) };
    } catch (error) {
      if (timedOut) throw new ModelProviderError("TIMEOUT");
      if (input.signal?.aborted) throw new ModelProviderError("CANCELLED");
      if (error instanceof ModelProviderError) throw error;
      throw new ModelProviderError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", cancel);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    }
  }
  private async request(input: ChatInput, signal: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.provider === "openai") headers.authorization = `Bearer ${input.credential}`;
    else { headers["x-api-key"] = input.credential!; headers["anthropic-version"] = "2023-06-01"; }
    const response = await this.fetcher(this.url, {
      method: "POST", redirect: "error", signal, headers,
      body: JSON.stringify({ model: this.config.model, messages: [{ role: "user", content: input.input }], stream: false,
        ...(this.provider === "openai" ? { max_completion_tokens: this.config.maxOutputTokens } : { max_tokens: this.config.maxOutputTokens }) }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ModelProviderError(response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED");
    }
    try { return await response.json(); } catch { throw new ModelProviderError("INVALID_RESPONSE"); }
  }
  /** The existing stream port accepts chunks. This implementation buffers one
   * bounded completion, with cancellation active through the full HTTP body. */
  async *stream(input: ChatInput & { signal: AbortSignal }): AsyncIterable<string> {
    const result = await this.complete(input);
    if (input.signal.aborted) throw new ModelProviderError("CANCELLED");
    yield result.output;
  }
}
export class OpenAIChatAdapter extends HostedChatAdapter {
  constructor(config: OpenAIChatConfig, fetcher: typeof fetch = fetch) { super("openai", config, config.apiVersion, fetcher); }
}
export class AnthropicChatAdapter extends HostedChatAdapter {
  constructor(config: AnthropicChatConfig, fetcher: typeof fetch = fetch) { super("anthropic", config, config.apiVersion, fetcher); }
}
