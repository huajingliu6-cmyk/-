import { describe, expect, it } from "vitest";
import {
  assertSafeStoryGenerationRequest,
  buildStoryGenerationRequest,
} from "@/projects/story/story-generation-prompt";
import { createStoryGenerationIdempotencyKey } from "@/projects/story/story-generation-client";
import { STORY_TEXT_MODELS } from "@/projects/story/constants";
import { SCRIPT_PDF_UNSUPPORTED_MESSAGE } from "@/projects/script/script-txt-client";

describe("buildStoryGenerationRequest", () => {
  it("uses page fields and story outputKind", () => {
    const body = buildStoryGenerationRequest({
      brief: "雨夜茶馆",
      modelKey: "balanced-default",
      targetChars: 500,
      idempotencyKey: "story_test_1",
    });
    expect(body).toEqual({
      outputKind: "story",
      brief: "雨夜茶馆",
      modelKey: "balanced-default",
      targetChars: 500,
      idempotencyKey: "story_test_1",
    });
  });

  it("is stable for identical inputs", () => {
    const a = buildStoryGenerationRequest({
      brief: "A",
      modelKey: "balanced-default",
      targetChars: 200,
      idempotencyKey: "k",
    });
    const b = buildStoryGenerationRequest({
      brief: "A",
      modelKey: "balanced-default",
      targetChars: 200,
      idempotencyKey: "k",
    });
    expect(a).toEqual(b);
  });

  it("does not invent cookies passwords or paths", () => {
    const body = buildStoryGenerationRequest({
      brief: "普通人设",
      modelKey: STORY_TEXT_MODELS[0]!.id,
      targetChars: 300,
      idempotencyKey: createStoryGenerationIdempotencyKey(),
    });
    expect(JSON.stringify(body)).not.toMatch(/cookie|password|apiKey|C:\\\\/i);
    expect(() => assertSafeStoryGenerationRequest(body)).not.toThrow();
  });
});

describe("PDF product unsupported", () => {
  it("exposes clear unsupported message", () => {
    expect(SCRIPT_PDF_UNSUPPORTED_MESSAGE).toMatch(/不支持 PDF/);
  });
});
