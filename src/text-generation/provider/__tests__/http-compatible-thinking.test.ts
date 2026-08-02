import { describe, expect, it } from "vitest";
import { buildHttpCompatibleChatBody } from "@/text-generation/provider/http-compatible-provider";

describe("buildHttpCompatibleChatBody thinking", () => {
  it("disables DeepSeek thinking by default", () => {
    const body = buildHttpCompatibleChatBody({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      messages: [],
      maxOutputTokens: 8192,
      stream: false,
    });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("enables DeepSeek thinking when requested", () => {
    const body = buildHttpCompatibleChatBody({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      messages: [],
      maxOutputTokens: 30_000,
      stream: true,
      enableThinking: true,
    });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.max_tokens).toBe(30_000);
  });

  it("does not attach thinking for non-DeepSeek models", () => {
    const body = buildHttpCompatibleChatBody({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      messages: [],
      maxOutputTokens: 1000,
      stream: false,
      enableThinking: true,
    });
    expect(body.thinking).toBeUndefined();
  });
});
