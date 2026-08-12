import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESIGN_ASSET_IMAGE_ASPECT_RATIO,
  DESIGN_ASSET_IMAGE_RESOLUTION,
  capabilityForDesignAssetType,
  designAssetPlatformRule,
  enrichDesignAssetImagePrompt,
} from "@/projects/assets/episode-design/generate-design-asset-image";
import {
  assembleImageStylePrompt,
  buildAssembledImagePrompt,
} from "@/ai-config/prompt-assembly";
import { publishRule, saveDraft } from "@/ai-config/task-rules-store";
import { readFileSync } from "fs";

describe("design asset image generation contract", () => {
  let tmp: string;
  const prevDataDir = process.env.APP_DATA_DIR;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-img-rules-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prevDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("maps asset types to image capabilities", () => {
    expect(capabilityForDesignAssetType("character")).toBe(
      "image.character.generate",
    );
    expect(capabilityForDesignAssetType("scene")).toBe("image.scene.generate");
    expect(capabilityForDesignAssetType("prop")).toBe("image.prop.generate");
    expect(capabilityForDesignAssetType("audio")).toBeNull();
  });

  it("platform brief only locks aspect/resolution, not style that fights admin rules", () => {
    expect(DESIGN_ASSET_IMAGE_ASPECT_RATIO).toBe("16:9");
    expect(DESIGN_ASSET_IMAGE_RESOLUTION).toBe("4K");
    const platform = designAssetPlatformRule("character");
    expect(platform).toContain("16:9");
    expect(platform).toContain("4K");
    expect(platform).not.toContain("禁止多视角");
    expect(platform).not.toContain("定妆表");

    const character = enrichDesignAssetImagePrompt("长发青年，青衫", "character");
    expect(character).toContain("16:9");
    expect(character).toContain("4K");
    expect(character).not.toContain("禁止多视角");

    const portrait = designAssetPlatformRule("character", "9:16", "medium");
    expect(portrait).toContain("9:16");
    expect(portrait).toContain("2K");
  });

  it("assembles final prompt with published admin task rule", async () => {
    await saveDraft(
      "image.character.generate",
      "三视图定妆表：正面侧面背面，白底。",
      "manual",
      null,
      null,
      "u1",
    );
    await publishRule("image.character.generate", null, "pub-img-1", "u1");

    const assembled = await buildAssembledImagePrompt({
      capabilityId: "image.character.generate",
      userPrompt: "长发青年，青衫",
      platformRule: designAssetPlatformRule("character"),
    });

    expect(assembled.adminRuleSource).toBe("custom");
    expect(assembled.finalPrompt).toContain("[ADMIN_PUBLISHED_TASK_RULE]");
    expect(assembled.finalPrompt).toContain("三视图定妆表");
    expect(assembled.finalPrompt).toContain("[用户当前提示词]");
    expect(assembled.finalPrompt).toContain("长发青年，青衫");
    expect(assembled.finalPrompt).not.toContain("禁止多视角");
  });

  it("falls back to builtin task rule when nothing published", async () => {
    const assembled = await buildAssembledImagePrompt({
      capabilityId: "image.prop.generate",
      userPrompt: "旧铜钥匙",
    });
    expect(assembled.adminRuleSource).toBe("builtin");
    expect(assembled.finalPrompt).toContain("[ADMIN_PUBLISHED_TASK_RULE]");
    expect(assembled.finalPrompt).toContain("道具");
  });

  it("assembleImageStylePrompt keeps section markers", () => {
    const text = assembleImageStylePrompt({
      platformRule: "16:9",
      adminRule: "定妆表",
      userPrompt: "角色A",
    });
    expect(text).toContain("[平台固定生成要求]");
    expect(text).toContain("定妆表");
    expect(text).toContain("角色A");
  });

  it("hides legacy asset-design-prompt virtual connection", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/ai-config/model-connections.ts"),
      "utf-8",
    );
    expect(src).toContain("legacy-slot-asset-design-prompt-text");
  });

  it("DesignAssetModal exposes preview download, histories and generation options", () => {
    const modal = readFileSync(
      path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    expect(modal).toContain("design-image-preview");
    expect(modal).toContain("design-download");
    expect(modal).toContain("design-prompt-history");
    expect(modal).toContain("design-image-history");
    expect(modal).toContain("design-image-quality");
    expect(modal).toContain("design-image-aspect-ratio");
    expect(modal).toContain("design-image-count");
    expect(modal).toContain("GlassSelect");
    expect(modal).toContain("menuPortal");
    expect(modal).not.toContain(
      'className="ead-generation-option__select"',
    );
    expect(modal).not.toMatch(/<select[\s\S]*design-image-quality/);
    expect(modal).toContain("quality: imageOptions.quality");
    expect(modal).toContain("aspectRatio: imageOptions.aspectRatio");
    expect(modal).toContain("count: imageOptions.count");
    expect(modal).toContain("生成资产");
    expect(modal).toContain("generateBusy");
    expect(modal).toContain("onGeneratingAssetChange");
    expect(modal).toContain('? "生成中…"');
  });

  it("image generation entrypoints call buildAssembledImagePrompt", () => {
    const design = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/episode-design/generate-design-asset-image.ts",
      ),
      "utf-8",
    );
    const character = readFileSync(
      path.join(process.cwd(), "src/workflow/lib/character-generation.ts"),
      "utf-8",
    );
    const scene = readFileSync(
      path.join(process.cwd(), "src/workflow/lib/scene-generation.ts"),
      "utf-8",
    );
    expect(design).toContain("buildAssembledImagePrompt");
    expect(character).toContain("buildAssembledImagePrompt");
    expect(scene).toContain("buildAssembledImagePrompt");
  });
});
