import { describe, expect, it } from "vitest";
import {
  IDLE_EMPTY_DESIGN_PROMPT,
  isIsolatedLibraryPromptScope,
  parseVariantDraftScopeId,
  resolveLibraryPromptScopeItem,
  type LibraryPromptAsset,
} from "@/projects/assets/library-asset-prompt";
import type { SceneAsset } from "@/projects/assets/types";
import type { SceneDesignItem } from "@/projects/assets/episode-design/types";

function scene(overrides: Partial<SceneAsset> = {}): SceneAsset {
  return {
    id: "scene_1",
    projectId: "proj_1",
    name: "韩兆丰别墅客厅",
    sceneType: "",
    description: "豪华别墅客厅，大理石地面",
    timeOfDay: "日",
    location: "室内",
    style: "写实",
    imageFileName: "scene_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "scene_1",
    approvedMediaIds: ["scene_1"],
    ...overrides,
  };
}

function designItem(): SceneDesignItem {
  return {
    id: "design_scene_1",
    name: "韩兆丰别墅客厅",
    assetType: "scene",
    resolution: "link_existing",
    existingAssetId: "scene_1",
    libraryAssetId: "scene_1",
    source: "manual",
    designPrompt: {
      status: "ready",
      text: "【画幅与构图】16:9 主场景提示词",
      generationId: null,
      sourceFingerprint: null,
      generatedAt: null,
      updatedAt: null,
      errorMessage: null,
      history: [],
    },
    draft: {
      description: "豪华别墅客厅，大理石地面",
      timeOfDay: "日",
      location: "室内",
      style: "写实",
      usageInEpisode: "",
      evidence: "",
    },
  };
}

describe("library prompt draft scope", () => {
  it("parses draft scope ids and marks them isolated", () => {
    expect(parseVariantDraftScopeId("draft:variant_draft_1")).toBe(
      "variant_draft_1",
    );
    expect(isIsolatedLibraryPromptScope("draft:variant_draft_1")).toBe(true);
    expect(isIsolatedLibraryPromptScope("appearance:look_1")).toBe(true);
    expect(isIsolatedLibraryPromptScope("primary")).toBe(false);
  });

  it("keeps empty draft scopes idle so primary prompt does not leak", () => {
    const asset = scene() as LibraryPromptAsset;
    const scoped = resolveLibraryPromptScopeItem(asset, "scene", designItem(), {
      promptScopeKey: "draft:variant_draft_1",
      promptScopeText: "",
      promptScopeMedia: null,
    });
    expect(scoped.designPrompt?.status).toBe(IDLE_EMPTY_DESIGN_PROMPT.status);
    expect(scoped.designPrompt?.text).toBe("");
    expect(scoped.id).toContain("draft:variant_draft_1");
    expect(scoped.designPrompt?.text).not.toContain("主场景提示词");
  });
});
