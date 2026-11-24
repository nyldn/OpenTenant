import type { AnthropicChatConfig, OpenAIChatConfig } from "./model-router-adapters";

/** Supplied by the typed server configuration composition root. No env reads. */
export interface ModelRouterProviderConfig {
  openai?: OpenAIChatConfig;
  anthropic?: AnthropicChatConfig;
}
