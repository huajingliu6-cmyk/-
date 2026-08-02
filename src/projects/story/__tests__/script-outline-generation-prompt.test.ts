import { describe, expect, it } from "vitest";
import {
  assertSafeScriptOutlineGenerationRequest,
  buildScriptOutlineGenerationRequest,
  SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT,
} from "@/projects/story/script-outline-generation-prompt";
import { createScriptOutlineIdempotencyKey } from "@/projects/story/story-generation-client";
import { STORY_TEXT_MODELS } from "@/projects/story/constants";
import { buildSystemPrompt } from "@/text-generation/prompts";

describe("buildScriptOutlineGenerationRequest", () => {
  it("uses page fields and script_outline outputKind", () => {
    const body = buildScriptOutlineGenerationRequest({
      brief: "雨夜茶馆复仇",
      modelKey: "balanced-default",
      idempotencyKey: "outline_test_1",
    });
    expect(body).toEqual({
      outputKind: "script_outline",
      brief: "雨夜茶馆复仇",
      modelKey: "balanced-default",
      targetChars: SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT,
      idempotencyKey: "outline_test_1",
    });
  });

  it("clamps targetChars and stays stable", () => {
    const a = buildScriptOutlineGenerationRequest({
      brief: "A",
      modelKey: "balanced-default",
      targetChars: 50,
      idempotencyKey: "k",
    });
    const b = buildScriptOutlineGenerationRequest({
      brief: "A",
      modelKey: "balanced-default",
      targetChars: 50,
      idempotencyKey: "k",
    });
    expect(a.targetChars).toBe(100);
    expect(a).toEqual(b);
  });

  it("does not invent cookies passwords or paths", () => {
    const body = buildScriptOutlineGenerationRequest({
      brief: "普通人设",
      modelKey: STORY_TEXT_MODELS[0]!.id,
      idempotencyKey: createScriptOutlineIdempotencyKey(),
    });
    expect(JSON.stringify(body)).not.toMatch(/cookie|password|apiKey|C:\\\\/i);
    expect(() => assertSafeScriptOutlineGenerationRequest(body)).not.toThrow();
  });

  it("server outline prompt asks for planning text not full script", () => {
    const prompt = buildSystemPrompt("script_outline", 400);
    expect(prompt).toMatch(/大纲/);
    expect(prompt).toMatch(/不是成片剧本正文|不要输出完整分集/);
  });
});
