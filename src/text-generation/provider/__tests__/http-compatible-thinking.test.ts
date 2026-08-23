import { describe, expect, it } from "vitest";
import {
  buildHttpCompatibleChatBody,
  normalizeHttpCompatibleBaseUrl,
} from "@/text-generation/provider/http-compatible-provider";

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

describe("normalizeHttpCompatibleBaseUrl", () => {
  it("appends /v1 for bare DeepSeek host", () => {
    expect(normalizeHttpCompatibleBaseUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/v1",
    );
    expect(normalizeHttpCompatibleBaseUrl("https://api.deepseek.com/")).toBe(
      "https://api.deepseek.com/v1",
    );
  });

  it("leaves existing /v1 paths unchanged", () => {
    expect(normalizeHttpCompatibleBaseUrl("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1",
    );
  });
});
