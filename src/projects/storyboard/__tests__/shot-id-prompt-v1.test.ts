import { describe, expect, it } from "vitest";
import { matchStoryboardPrompts } from "@/projects/storyboard/services/match-storyboard-prompts";
import { parseStoryboardModelResponse } from "@/projects/storyboard/services/parse-storyboard-model-response";
import { sanitizeStoryboardVideoPromptText } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import { STORYBOARD_PROMPT_PROTOCOL_VERSION } from "@/projects/storyboard/services/storyboard-prompt-contract";
import { STORYBOARD_PROMPT_RULE_VERSION } from "@/projects/storyboard/storyboard-video-params";

describe("SHOT_ID_PROMPT_V1 protocol", () => {
  it("exports protocol version", () => {
    expect(STORYBOARD_PROMPT_PROTOCOL_VERSION).toBe("SHOT_ID_PROMPT_V1");
    expect(STORYBOARD_PROMPT_RULE_VERSION).toBe("SHOT_ID_PROMPT_V1");
  });

  it("matches shots by id when order differs", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [
          { shotId: "b", videoPrompt: "第二" },
          { shotId: "a", videoPrompt: "第一" },
        ],
      }),
    );
    const matched = matchStoryboardPrompts({
      targets: [
        { id: "a", shotNumber: 1 },
        { id: "b", shotNumber: 2 },
      ],
      prompts: parsed.prompts,
    });
    expect(matched.matched.get("a")).toBe("第一");
    expect(matched.matched.get("b")).toBe("第二");
  });

  it("preserves brackets and newlines in sanitize", () => {
    const body = "【总时长】14秒\n【声音设计】雨\n禁止抖动。";
    expect(sanitizeStoryboardVideoPromptText(body)).toBe(body);
  });

  it("does not call clip renderer for model shots json body", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [{ shotId: "a", videoPrompt: "自由正文，无时间轴" }],
      }),
    );
    expect(parsed.prompts[0]?.videoPrompt).toBe("自由正文，无时间轴");
  });

  it("platform contract and builtin do not prescribe PromptClip body sections", async () => {
    const { buildStoryboardShotsJsonContract } = await import(
      "@/projects/storyboard/services/storyboard-prompt-contract"
    );
    const { buildImmutableOutputContract } = await import(
      "@/ai-config/output-contracts"
    );
    const { getBuiltinTaskRule } = await import(
      "@/ai-config/builtin-task-rules"
    );
    const contract = buildStoryboardShotsJsonContract();
    const immutable = buildImmutableOutputContract(
      "text.storyboard-prompt.generate",
    );
    const rule = getBuiltinTaskRule("text.storyboard-prompt.generate");
    for (const key of [
      "【总时长】",
      "【核心指令·音视频同步】",
      "【首帧锚点】",
      "【时间轴·强制映射】",
      "【尾帧锚点】",
      "【微表情与肢体指令】",
      "【声音设计】",
      "PromptClip",
    ]) {
      expect(contract).not.toContain(key);
      expect(immutable).not.toContain(key);
      expect(rule).not.toContain(key);
    }
    expect(contract).toContain("videoPrompt");
    expect(immutable).toContain("非空字符串");
  });
});
