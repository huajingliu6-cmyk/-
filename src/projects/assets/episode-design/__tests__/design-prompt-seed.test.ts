import { describe, expect, it } from "vitest";
import {
  buildDesignPromptBrief,
  formatDesignDraftSeedText,
  looksLikeExtractDraftPrompt,
  resolveFormalDesignPromptText,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import type { CharacterDesignItem } from "@/projects/assets/episode-design/types";
import { readFileSync } from "fs";
import path from "path";

function characterItem(
  patch: Partial<CharacterDesignItem["draft"]> = {},
): CharacterDesignItem {
  return {
    id: "item-1",
    assetType: "character",
    name: "江宸",
    resolution: "create_new",
    existingAssetId: null,
    libraryAssetId: null,
    source: "ai",
    draft: {
      description: "沉稳果敢的青年",
      appearance: "长发及腰，眉眼清冷",
      clothing: "青衫白袍",
      role: "男主",
      age: "20",
      voiceId: null,
      voiceName: null,
      voiceBound: false,
      usageInEpisode: "开场登场",
      evidence: "第一集",
      ...patch,
    },
  };
}

describe("formatDesignDraftSeedText", () => {
  it("formats extracted draft fields for the extract-info panel", () => {
    const text = formatDesignDraftSeedText(characterItem());
    expect(text).toContain("【角色描述】沉稳果敢的青年");
    expect(text).toContain("【外貌】长发及腰，眉眼清冷");
    expect(text).toContain("【服装】青衫白袍");
    expect(text).not.toContain("本集正文");
  });

  it("omits empty fields", () => {
    const text = formatDesignDraftSeedText(
      characterItem({ clothing: "", age: "", evidence: "" }),
    );
    expect(text).not.toContain("【服装】");
    expect(text).not.toContain("【年龄】");
    expect(text).toContain("【外貌】");
  });

  it("buildDesignPromptBrief is facts-only (no ambiguous photoreal bans)", () => {
    const brief = buildDesignPromptBrief(
      characterItem(),
      "江宸走入大厅。",
      "青衫要有褶皱",
    );
    expect(brief).toContain("【资产名称】江宸");
    expect(brief).toContain("【外貌】长发及腰，眉眼清冷");
    expect(brief).toContain("【本集正文摘录】");
    expect(brief).toContain("江宸走入大厅。");
    expect(brief).toContain("【用户素材要求】");
    expect(brief).toContain("青衫要有褶皱");
    expect(brief).not.toContain("避免写实真人");
    expect(brief).not.toContain("禁止真人");
    expect(brief).not.toContain("不要写实人脸");
    expect(brief).not.toContain("请据此撰写");
  });
});

describe("dirty formal prompt detection", () => {
  it("treats seed-equal or extract-sourced text as not generated", () => {
    const item = characterItem();
    const seed = formatDesignDraftSeedText(item);
    expect(looksLikeExtractDraftPrompt(seed, item)).toBe(true);
    expect(
      resolveFormalDesignPromptText({
        ...item,
        designPrompt: {
          status: "ready",
          text: seed,
          generationId: null,
          sourceFingerprint: null,
          generatedAt: null,
          updatedAt: null,
          errorMessage: null,
          history: [
            {
              text: seed,
              generatedAt: "2026-01-01T00:00:00.000Z",
              generationId: null,
              source: "extract",
            },
          ],
        },
      }),
    ).toBe("");
  });

  it("keeps real regenerated prompts", () => {
    const item = characterItem();
    const formal =
      "超写实真人影视摄影质感，虚构角色江宸，青衫白袍，侧光电影剧照，16:9";
    expect(looksLikeExtractDraftPrompt(formal, item)).toBe(false);
    expect(
      resolveFormalDesignPromptText({
        ...item,
        designPrompt: {
          status: "ready",
          text: formal,
          generationId: "tg_abc",
          sourceFingerprint: "fp",
          generatedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          errorMessage: null,
          history: [
            {
              text: formal,
              generatedAt: "2026-01-01T00:00:00.000Z",
              generationId: "tg_abc",
              source: "regenerate",
            },
          ],
        },
      }),
    ).toBe(formal);
  });
});

describe("DesignAssetModal formal prompt vs extract info", () => {
  const modal = readFileSync(
    path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
    "utf-8",
  );

  it("never puts extract seed into the formal textarea", () => {
    expect(modal).toContain("formatDesignDraftSeedText");
    expect(modal).toContain("resolveFormalDesignPromptText");
    expect(modal).toContain('data-testid="design-extract-info"');
    expect(modal).toContain("资产提取信息");
    expect(modal).toContain("尚未生成");
    expect(modal).toContain('data-testid="design-prompt-not-generated"');
    expect(modal).not.toContain("initialPromptForItem");
    expect(modal).not.toContain("didSeedExtract");
    expect(modal).not.toContain("buildInitialPromptHistory");
    expect(modal).toContain("模型未返回有效的资产设计提示词");
  });

  it("does not call onPromptUpdated on mount to seed extract draft", () => {
    expect(modal).not.toMatch(
      /useEffect\(\(\) => \{\s*if \(!didSeedExtract\)/,
    );
    expect(modal).not.toContain(
      "onPromptUpdatedRef.current(item.id, seed",
    );
  });

  it("keeps regenerate controls and requirement dialog", () => {
    expect(modal).toContain("重新生成提示词");
    expect(modal).toContain("输入素材要求");
    expect(modal).toContain("userRequirement");
    expect(modal).toContain("promptModelId");
    expect(modal).toContain("design-prompt-actions");
    expect(modal).toContain("design-regenerate-requirement-input");
    expect(modal).not.toContain("近景头像＋三视图");
    expect(modal).not.toMatch(/needsAuto/);

    const textareaIdx = modal.indexOf('data-testid="design-prompt-textarea"');
    const regenerateIdx = modal.indexOf('data-testid="design-regenerate-prompt"');
    const footIdx = modal.indexOf('className="ead-modal__foot"');
    expect(textareaIdx).toBeGreaterThan(-1);
    expect(regenerateIdx).toBeGreaterThan(textareaIdx);
    expect(regenerateIdx).toBeLessThan(footIdx);
  });
});
