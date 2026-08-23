import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("unified asset management interactions", () => {
  const toolbar = readSrc("src/projects/assets/AssetExtractionToolbar.tsx");
  const workspace = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
  const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
  const imageUpload = readSrc("src/projects/assets/AssetImageUpload.tsx");
  const imageEditor = readSrc(
    "src/projects/assets/LibraryAssetImageEditor.tsx",
  );
  const promptModal = readSrc(
    "src/projects/assets/LibraryAssetPromptModal.tsx",
  );
  const designModal = readSrc("src/projects/assets/DesignAssetModal.tsx");
  const character = readSrc("src/projects/assets/CharacterDetail.tsx");
  const characterManager = readSrc(
    "src/projects/assets/CharacterManager.tsx",
  );
  const scene = readSrc("src/projects/assets/SceneManager.tsx");
  const prop = readSrc("src/projects/assets/PropManager.tsx");
  const compactList = readSrc("src/projects/assets/AssetCompactList.tsx");
  const imageRoute = readSrc(
    "src/app/api/projects/[projectId]/assets-draft/images/[assetId]/route.ts",
  );
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("shows episode assets from a direct toolbar dropdown", () => {
    expect(toolbar).toContain("查看单集资产");
    expect(toolbar).toContain("asset-view-episode-assets");
    expect(toolbar).toContain("asset-episode-assets-action-select");
    expect(toolbar).toContain("viewEpisodeOptions");
    expect(toolbar).not.toContain("asset-episode-assets-button");
    expect(toolbar).not.toContain("当前资产");
    expect(toolbar).not.toContain("已提取");
    expect(workspace).toContain("ALL_EPISODES_VALUE");
    expect(workspace).toContain("viewEpisodeAssets");
    expect(workspace).not.toContain('setEpisodePickerMode("view")');
  });

  it("locks the unified page while extraction is busy", () => {
    expect(workspace).toContain("inert={pageLocked ? true : undefined}");
    expect(workspace).toContain("extractionBusy");
    expect(guard).toContain("asset-extraction-overlay");
    expect(css).toContain("ead-progress-flow");
  });

  it("uses asset-specific replacement copy; character uses candidate upload without 替换形象", () => {
    expect(character).not.toContain("替换形象");
    expect(character).toContain("replace-primary");
    expect(character).toContain("确认使用");
    expect(character).toContain("postLibrarySd2Precheck");
    expect(character).toContain("character-look-add");
    expect(scene).toContain('actionLabel="替换场景"');
    expect(prop).toContain('actionLabel="替换道具"');
    expect(imageUpload).toContain("targetMediaId: uploadTargetId");
    expect(imageUpload).toContain("customUpload");
    expect(imageRoute).toContain('get("targetMediaId")');
    expect(imageRoute).toContain("ownedMediaIds.has(targetMediaId)");
  });

  it("character page embeds prompt panel; scene/prop keep modal context menu", () => {
    expect(compactList).toContain("onContextMenu={");
    expect(compactList).toContain("onEdit");
    expect(compactList).toMatch(
      /onContextMenu=\{\s*onEdit\s*\?/,
    );
    expect(imageEditor).toContain("AssetImageEditPanel");
    expect(promptModal).toContain("hideImageEdit");
    expect(promptModal).toContain("LibraryAssetPromptPanel");
    expect(promptModal).toContain('mode="embedded"');
    expect(designModal).toContain('variant?: "modal" | "embedded"');
    expect(designModal).toContain("onCurrentMediaChange");
    expect(designModal).toContain("design-prompt-textarea");
    expect(designModal).not.toContain("design-prompt-history-toggle");
    expect(designModal).not.toContain("design-prompt-history");
    expect(designModal).toContain("design-image-history-toggle");
    expect(designModal).toContain("design-copy");
    expect(designModal).toContain("design-generate-asset");
    expect(designModal).toContain("design-adjust-params");
    expect(designModal).toContain("prompt-generation-summary");
    expect(designModal).toContain("design-params-popover");
    expect(designModal).toContain("resolveLibraryGenerateTarget");
    expect(designModal).toContain('form.set("mode", "text_to_image")');
    expect(designModal).toContain("/assets-draft/media/generate");
    expect(designModal).toContain("design-download");
    expect(designModal).toContain("design-video-ref-precheck");
    expect(characterManager).toContain("AppToastHost");
    expect(characterManager).not.toContain("LibraryAssetPromptModal");
    expect(characterManager).not.toContain("imageEditorId");
    expect(characterManager).not.toContain("onEdit=");
    expect(scene).toContain("LibraryAssetPromptModal");
    expect(prop).toContain("LibraryAssetPromptModal");
    expect(character).toContain("LibraryAssetPromptPanel");
    expect(character).toContain("onCurrentMediaChange");
    expect(character).toContain("LibraryCharacterLookEditor");
    expect(character).not.toContain("CreateCharacterLookDialog");
    expect(character).toContain("确认使用");
    expect(character).toContain("新增人物造型");
    expect(character).not.toContain("设为主造型");
    expect(character).toContain("character-history-trigger");
    expect(character).toContain("character-history-popover");
    expect(character).not.toContain("character-generation-history");
    expect(character).not.toContain("AssetBasicInfo");
    expect(character).not.toContain('label: "定位"');
    expect(character).not.toContain('label: "年龄"');
  });
});
