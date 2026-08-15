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
    expect(shell).not.toContain("amw-head--shell");
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
    expect(workspace).not.toContain("asset-library-extraction-panel");
    expect(toolbar).toContain("GlassSelect");
    expect(toolbar).toContain("一键提取资产");
    expect(toolbar).toContain("全剧本提取");
    expect(toolbar).toContain("选集提取");
    expect(toolbar).not.toContain("已入库");
    expect(toolbar).toContain("查看单集资产");
    expect(toolbar).not.toContain("当前资产");
    expect(workspace).toContain("showApprovalUi={approvalEnabled}");
    expect(workspace).toContain("submitApprovalRequestId={submitApprovalRequestId}");
    expect(workspace).toContain('data-testid="asset-submit-approval"');
    expect(workspace).toContain("提交审批");
    expect(workspace).toContain("所有人协作");
    expect(workspace).not.toContain("activeSurface");
    expect(workspace).not.toContain("asset-library-surface-toggle");
    expect(character).toContain("character-looks");
    expect(character).toContain("角色造型");
    expect(character).toContain("新增造型");
    expect(character).toContain("LibraryCharacterLookEditor");
    expect(lookEditor).toContain("/assets-draft/media/generate");
    expect(lookEditor).toContain("/assets-draft/media/save");
    expect(lookEditor).not.toContain("入库");
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
    expect(source).toContain("ead-extract-all");
    expect(source).toContain("一键提取");
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
