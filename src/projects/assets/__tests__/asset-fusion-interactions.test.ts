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
  const imageUpload = readSrc("src/projects/assets/AssetImageUpload.tsx");
  const imageEditor = readSrc(
    "src/projects/assets/LibraryAssetImageEditor.tsx",
  );
  const promptModal = readSrc(
    "src/projects/assets/LibraryAssetPromptModal.tsx",
  );
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

  it("locks the unified page and reuses extraction progress animation", () => {
    expect(workspace).toContain("inert={pageLocked ? true : undefined}");
    expect(workspace).toContain("asset-extraction-page-lock");
    expect(workspace).toContain("onExtractionProgressChange");
    expect(workspace).toContain("asset-extraction-progress-percent");
    expect(css).toContain("ead-progress-flow");
    expect(css).toContain(".asset-library-page__lock");
  });

  it("uses asset-specific replacement copy and targets the active look", () => {
    expect(character).toContain('actionLabel="替换形象"');
    expect(character).toContain("uploadTargetId={activeMediaId}");
    expect(character).toContain("preserveValueOnUpload");
    expect(scene).toContain('actionLabel="替换场景"');
    expect(prop).toContain('actionLabel="替换道具"');
    expect(imageUpload).toContain("targetMediaId: uploadTargetId");
    expect(imageRoute).toContain('get("targetMediaId")');
    expect(imageRoute).toContain("ownedMediaIds.has(targetMediaId)");
  });

  it("opens the prompt design card from a list-item context menu", () => {
    expect(compactList).toContain("onContextMenu");
    expect(compactList).toContain("onEdit?.(item.id)");
    expect(imageEditor).toContain("AssetImageEditPanel");
    expect(imageEditor).toContain("existingMediaIds");
    expect(imageEditor).toContain("referenceMediaId");
    expect(promptModal).toContain("hideImageEdit");
    expect(characterManager).toContain("LibraryAssetPromptModal");
    expect(scene).toContain("LibraryAssetPromptModal");
    expect(prop).toContain("LibraryAssetPromptModal");
    expect(characterManager).not.toContain("LibraryAssetImageEditor");
    expect(scene).not.toContain("LibraryAssetImageEditor");
    expect(prop).not.toContain("LibraryAssetImageEditor");
    expect(characterManager).not.toContain("initialDraft=");
    expect(scene).not.toContain("initialDraft=");
    expect(prop).not.toContain("initialDraft=");
    expect(character).toContain("新增造型");
  });
});
