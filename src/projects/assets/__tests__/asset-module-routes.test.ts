import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset module management routes", () => {
  it("legacy /assets redirects to the unified asset library after auth", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/page.tsx",
    );
    expect(source).toContain("router.replace");
    expect(source).toContain("/assets/library");
    expect(source).not.toContain("AssetManagementWorkspace");
  });

  it("legacy design page redirects to the unified asset library", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/design/page.tsx",
    );
    expect(source).toContain("redirect(");
    expect(source).toContain("/assets/library");
    expect(source).not.toContain("panel=extract");
    expect(source).not.toContain("EpisodeAssetDesignWorkspace");
  });

  it("library page only mounts stored asset management", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/library/page.tsx",
    );
    expect(source).toContain("ProjectAssetsManagementPage");
    expect(source).toContain('module="library"');
    expect(source).toContain("AssetManagementWorkspace");
    expect(source).not.toContain("EpisodeAssetDesignWorkspace");
    expect(source).not.toContain("剧集列表");
    expect(source).toContain("embedded");

    const workspace = readSrc(
      "src/projects/assets/AssetManagementWorkspace.tsx",
    );
    const shell = readSrc("src/projects/assets/ProjectAssetsShell.tsx");
    const css = readSrc("src/projects/assets/asset-workspace.css");
    expect(workspace).toContain("amw-library-workspace");
    expect(workspace).not.toContain("amw-head");
    expect(workspace).toContain("asset-library-toolbar__save");
    expect(workspace).toContain('"保存"');
    expect(workspace).toContain("persistLibraryDesignItems");
    expect(workspace).toContain("UnsavedPromptDialog");
    expect(shell).not.toContain("amw-head--shell");
    expect(css).toMatch(
      /\.asset-library-page__inner[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\)/,
    );
    expect(css).not.toMatch(
      /\.asset-library-page__inner[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.amw-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(260px, 3fr\) minmax\(0, 7fr\)/,
    );
  });

  it("workspace assets entry sends all asset roles to the unified library", () => {
    const entry = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/page.tsx",
    );
    expect(entry).toContain("router.replace");
    expect(entry).toContain("workspaceProjectAssetsLibraryPath");
    expect(entry).not.toContain("workspaceProjectAssetsDesignPath");

    const library = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/library/page.tsx",
    );
    expect(library).toContain("WorkspaceAssetsPage");
    expect(library).toContain("AssetManagementWorkspace");
    expect(library).not.toContain("EpisodeAssetDesignWorkspace");
    expect(library).toContain('context="workspace"');

    const workspace = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    expect(workspace).toContain(
      "`/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`",
    );
    expect(workspace).toContain('isWorkspace ? "workspace" : "management"');

    const design = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/design/page.tsx",
    );
    expect(design).toContain("redirect(");
    expect(design).toContain("workspaceProjectAssetsLibraryPath(projectId)");
    expect(design).not.toContain("panel=extract");
    expect(design).not.toContain("EpisodeAssetDesignWorkspace");

    const designLayout = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/design/layout.tsx",
    );
    expect(designLayout).toContain("assertWorkspaceAssetDesignPage");

    const pageGuards = readSrc("src/auth/page-guards.ts");
    expect(pageGuards).not.toContain("denied=design");
  });

  it("AssetModuleNav exposes only the asset library", () => {
    const source = readSrc("src/projects/assets/AssetModuleNav.tsx");
    expect(source).toContain("workspaceProjectAssetsPath");
    expect(source).not.toContain('label: "资产设计"');
    expect(source).toContain("资产库");
  });

  it("project management detail links assets stage to library", () => {
    const source = readSrc(
      path.join("src", "app", "app", "projects", "[projectId]", "page.tsx"),
    );
    const nav = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    expect(source).not.toContain("wb-stage");
    expect(nav).toContain("/assets/library");
    expect(nav).toContain('id: "assets"');
    expect(nav).toContain('data-testid={`${mode}-nav-${stage.id}`}');
  });

  it("keeps extraction controls inside the single asset management page", () => {
    const workspace = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    const toolbar = readSrc(
      "src/projects/assets/AssetExtractionToolbar.tsx",
    );
    const character = readSrc("src/projects/assets/CharacterDetail.tsx");
    const lookEditor = readSrc(
      "src/projects/assets/LibraryCharacterLookEditor.tsx",
    );
    expect(workspace).toContain("EpisodeAssetDesignWorkspace");
    expect(workspace).toContain("headless");
    expect(workspace).not.toContain("onExtractionRequestConsumed={handleExtractionRequestConsumed}");
    expect(workspace).not.toContain("`asset-extract-${projectId}-${safeRandomUUID()}`");
    expect(workspace).not.toContain("asset-library-extraction-panel");
    expect(workspace).toMatch(
      /className="asset-library-library-surface"\s*key=\{`\$\{visibleTab\}-\$\{tabKey\}-\$\{viewEpisodeId \?\? "all"\}`\}/,
    );
    expect(toolbar).toContain("GlassSelect");
    expect(toolbar).toContain("提取本集资产");
    expect(toolbar).not.toContain("全剧本提取");
    expect(toolbar).not.toContain("一键提取资产");
    expect(toolbar).not.toContain("已入库");
    expect(toolbar).toContain("查看单集资产");
    expect(toolbar).toContain("trailing");
    expect(toolbar).toContain("asset-extraction-toolbar__trailing");
    expect(toolbar).not.toContain("当前资产");
    expect(workspace).toContain("trailing={");
    expect(workspace).toContain("showApprovalUi={approvalEnabled}");
    expect(workspace).toContain("submitApprovalRequestId={submitApprovalRequestId}");
    expect(workspace).toContain('data-testid="asset-submit-approval"');
    expect(workspace).toContain("提交审批");
    expect(workspace).not.toContain("所有人协作");
    expect(workspace).not.toContain("审批协作");
    expect(workspace).not.toContain("asset-collaboration-badge");
    expect(workspace).not.toContain("activeSurface");
    expect(workspace).not.toContain("asset-library-surface-toggle");
    expect(character).toContain("character-prompt-split");
    expect(character).toContain("character-history-trigger");
    expect(character).toContain("character-history-popover");
    expect(character).not.toContain("character-generation-history");
    expect(character).toContain("LibraryCharacterLookEditor");
    expect(character).not.toContain("CreateCharacterLookDialog");
    expect(character).toContain("新增人物造型");
    expect(character).toContain("LibraryAssetPromptPanel");
    expect(character).not.toContain("AssetBasicInfo");
    expect(lookEditor).toContain("/assets-draft/media/generate");
    expect(lookEditor).toContain("/assets-draft/characters/");
    expect(lookEditor).toContain("append-appearance-media");
    expect(lookEditor).toContain("add-look");
    expect(lookEditor).toContain('form.set("setPrimary", "false")');
    expect(lookEditor).not.toContain("confirm-appearance");
    expect(lookEditor).not.toContain("/assets-draft/media/save");
    expect(lookEditor).not.toContain("入库");
    expect(character).toContain("confirm-appearance");
    expect(character).toContain("确认使用");
  });

  it("design workspace no longer embeds 查看资产库 shortcut", () => {
    const source = readSrc(
      "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
    );
    expect(source).not.toContain("查看资产库");
    expect(source).toContain("查看本集剧本");
    expect(source).toContain("保存本集资产");
    expect(source).toContain("CharacterCreateDialog");
    expect(source).toContain("SceneCreateDialog");
    expect(source).toContain("PropCreateDialog");
    expect(source).not.toContain("AudioCreateDialog");
    expect(source).toContain("pendingMedia");
    expect(source).toContain("createdAssets");
    expect(source).toContain("ead-extract-episode");
    expect(source).toContain("提取本集资产");
    expect(source).not.toContain("ead-extract-all");
    expect(source).not.toContain("一键提取");
    expect(source).toContain("按集补提取");
    expect(source).toContain("ead-episode-select");
    expect(source).not.toContain("ead-ep-list");
    expect(source).toContain("SubmitApprovalModal");
  });

  it("story-generation-client supports episode_asset_design outputKind", () => {
    const source = readSrc("src/projects/story/story-generation-client.ts");
    expect(source).toContain("episode_asset_design");
    expect(source).toContain("episodeId");
  });
});
