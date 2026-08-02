import type { ProviderTextStreamEvent } from "@/text-generation/types";

export type ProviderChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderTextGenerationInput = {
  systemPrompt: string;
  userPrompt: string;
  providerModelId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
  /**
   * DeepSeek V4: when true, send `thinking: { type: "enabled" }`.
   * Reasoning tokens share max_tokens — callers must raise the budget.
   */
  enableThinking?: boolean;
  /** When set, sent as chat history instead of [system, user]. */
  messages?: ProviderChatMessage[];
};

export interface TextGenerationProvider {
  streamText(
    input: ProviderTextGenerationInput,
  ): AsyncGenerator<ProviderTextStreamEvent, void, unknown>;

  estimateInputTokens(text: string): number;

  estimateMaxOutputTokens(targetChars: number, factor: number, cap: number): number;
}
