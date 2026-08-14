import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  assertValidDesignPromptText,
  streamRedesignPromptInConversation,
} from "@/projects/assets/episode-design/generate-design-prompt";
import {
  buildDesignPromptUserPayloadText,
  containsForbiddenExtractFieldTags,
  extractAssetFacts,
  legacyExtractSeedTextForCompare,
  looksLikeExtractDraftPrompt,
  resolveFormalDesignPromptText,
  sanitizeFormalDesignPromptCandidate,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

function characterItem(
  overrides?: Partial<EpisodeAssetDesignItem>,
): EpisodeAssetDesignItem {
  return {
    id: "char-1",
    assetType: "character",
    name: "林清",
    draft: {
      description: "沉稳果敢的青年",
      appearance: "短发，深色瞳孔",
      clothing: "深灰西装",
      role: "男主",
      age: "29",
      usageInEpisode: "法庭对峙",
      evidence: "第1集",
    },
    ...overrides,
  } as EpisodeAssetDesignItem;
}

describe("structured design-prompt facts (no field-title seed)", () => {
  it("extracts internal facts without labeled titles", () => {
    const facts = extractAssetFacts(characterItem());
    expect(facts).toEqual({
      description: "沉稳果敢的青年",
      appearance: "短发，深色瞳孔",
      clothing: "深灰西装",
      role: "男主",
      age: "29",
      usageInEpisode: "法庭对峙",
      evidence: "第1集",
    });
  });

  it("user payload is JSON facts + instructions, not 【角色描述】 output schema", () => {
    const payload = buildDesignPromptUserPayloadText(
      characterItem(),
      "本集正文示例",
      "",
    );
    expect(payload).toContain('"assetType": "character"');
    expect(payload).toContain('"appearance": "短发，深色瞳孔"');
    expect(payload).toContain("仅为事实输入，不是输出格式");
    expect(payload).toContain("一整段完整、连贯");
    expect(payload).not.toMatch(/【角色描述】沉稳/);
  });

  it("legacy seed compare still detects dirty historical labeled text", () => {
    const seed = legacyExtractSeedTextForCompare(characterItem());
    expect(seed).toContain("【角色描述】");
    expect(looksLikeExtractDraftPrompt(seed, characterItem())).toBe(true);
    expect(containsForbiddenExtractFieldTags(seed)).toBe(true);
  });
});

describe("resolveFormalDesignPromptText dirty data", () => {
  it("hides labeled extract dumps and extract-sourced rows", () => {
    const item = characterItem({
      designPrompt: {
        status: "ready",
        text: "【角色描述】女主\n【外貌】短发\n【服装】青衫",
        generationId: null,
        sourceFingerprint: null,
        generatedAt: null,
        updatedAt: null,
        errorMessage: null,
        history: [],
      },
    });
    expect(resolveFormalDesignPromptText(item)).toBe("");

    const extractSourced = characterItem({
      designPrompt: {
        status: "ready",
        text: "【角色描述】女主\n【外貌】短发\n【服装】青衫",
        generationId: null,
        sourceFingerprint: null,
        generatedAt: null,
        updatedAt: null,
        errorMessage: null,
        history: [
          {
            text: "【角色描述】女主\n【外貌】短发\n【服装】青衫",
            generatedAt: new Date().toISOString(),
            generationId: null,
            source: "extract",
          },
        ],
      },
    });
    expect(resolveFormalDesignPromptText(extractSourced)).toBe("");
  });

  it("keeps continuous formal Chinese prompts", () => {
    const formal =
      "横构图电影剧照，虚构青年律师立于法庭中央，短发深色瞳孔，深灰西装，冷硬侧光，写实影视摄影质感。";
    expect(
      resolveFormalDesignPromptText(
        characterItem({
          designPrompt: {
            status: "ready",
            text: formal,
            generationId: "tg_abc",
            sourceFingerprint: null,
            generatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            errorMessage: null,
            history: [],
          },
        }),
      ),
    ).toBe(formal);
  });
});

describe("assertValidDesignPromptText", () => {
  it("rejects any forbidden extract field tag", () => {
    expect(() =>
      assertValidDesignPromptText("【角色描述】女主 站在窗前", characterItem()),
    ).toThrow(/资产提取摘录|AI_DESIGN_PROMPT_FORMAT_INVALID|正式素材提示词/);
  });

  it("rejects english concept art fallback", () => {
    expect(() =>
      assertValidDesignPromptText("concept art of a young woman", characterItem()),
    ).toThrow(/concept art/);
  });

  it("sanitizes to one continuous paragraph and accepts formal Chinese", () => {
    const cleaned = assertValidDesignPromptText(
      "横构图电影剧照。\n\n虚构青年律师短发深色瞳孔。\n- 深灰西装\n写实侧光。",
      characterItem(),
    );
    expect(cleaned).not.toContain("\n");
    expect(cleaned).toContain("横构图电影剧照");
    expect(cleaned).not.toContain("【角色描述】");
  });

  it("sanitizeFormalDesignPromptCandidate collapses lists and fences", () => {
    expect(
      sanitizeFormalDesignPromptCandidate("```text\n甲\n\n乙\n```"),
    ).toBe("甲 乙");
  });
});

describe("DesignAssetModal formal prompt UI", () => {
  const modal = readFileSync(
    path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
    "utf-8",
  );
  const workspace = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
    ),
    "utf-8",
  );

  it("does not show extract-info region or labeled field titles", () => {
    expect(modal).not.toContain('data-testid="design-extract-info"');
    expect(modal).not.toContain("资产提取信息");
    expect(modal).not.toContain("formatDesignDraftSeedText");
    expect(modal).not.toContain("【角色描述】");
    expect(modal).not.toContain("【外貌】");
    expect(modal).not.toContain("【服装】");
    expect(modal).toContain("resolveFormalDesignPromptText");
    expect(modal).toContain("尚未生成");
    expect(modal).toContain("生成提示词");
    expect(modal).toContain("重新生成提示词");
    expect(modal).toContain("designPromptAutoGenKey");
    expect(modal).toContain('void regeneratePromptRef.current("")');
    expect(modal).toContain("handlePromptGenerateClick");
    expect(modal).not.toContain("initialPromptForItem");
    expect(modal).not.toContain("didSeedExtract");
    expect(modal).not.toContain("buildInitialPromptHistory");
  });

  it("auto-generates once without requiring userRequirement dialog first", () => {
    expect(modal).toContain("formalPromptMissing");
    expect(modal).toContain("autoPromptKeyRef");
    expect(modal).toMatch(/if \(formalPromptMissing\) \{\s*void regeneratePrompt\(""\)/);
    expect(workspace).toContain("kickOffFormalDesignPrompts");
    expect(workspace).toContain("autoGenerateMissingFormalDesignPrompts");
    expect(workspace).toContain("DEFAULT_DESIGN_PROMPT_MODEL_ID");
  });

  it("keeps regenerate requirement dialog only for re-generate path", () => {
    expect(modal).toContain("输入素材要求");
    expect(modal).toContain("userRequirement");
    expect(modal).toContain("design-regenerate-requirement-input");
    expect(modal).toContain("生成提示词");
  });
});

// Keep stream import referenced for typecheck of test module graph.
void streamRedesignPromptInConversation;
