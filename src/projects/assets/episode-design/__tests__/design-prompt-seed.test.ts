import { describe, expect, it } from "vitest";
import {
  buildDesignPromptBrief,
  formatDesignDraftSeedText,
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
  it("formats extracted draft fields for the design modal input", () => {
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

  it("buildDesignPromptBrief still includes seed + episode excerpt", () => {
    const brief = buildDesignPromptBrief(characterItem(), "江宸走入大厅。");
    expect(brief).toContain("【资产名称】江宸");
    expect(brief).toContain("【外貌】长发及腰，眉眼清冷");
    expect(brief).toContain("【本集正文摘录】");
    expect(brief).toContain("江宸走入大厅。");
  });
});

describe("DesignAssetModal seeds extraction text", () => {
  it("opens with draft seed instead of auto-fetching when text exists", () => {
    const modal = readFileSync(
      path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    expect(modal).toContain("format-design-draft-seed");
    expect(modal).toContain("formatDesignDraftSeedText");
    expect(modal).toContain("initialPromptForItem");
    expect(modal).toContain("重新生成提示词");
    expect(modal).not.toContain("近景头像＋三视图");
    expect(modal).not.toMatch(/needsAuto/);
    expect(modal).not.toContain("generate-design-prompt");
  });
});
