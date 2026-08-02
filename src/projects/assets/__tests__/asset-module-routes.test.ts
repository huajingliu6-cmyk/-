import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset module management routes", () => {
  it("legacy /assets redirects to design after auth", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/page.tsx",
    );
    expect(source).toContain("router.replace");
    expect(source).toContain("/assets/design");
    expect(source).not.toContain("AssetManagementWorkspace");
  });

  it("design page mounts shell nav and EpisodeAssetDesignWorkspace", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/design/page.tsx",
    );
    expect(source).toContain("ProjectAssetsManagementPage");
    expect(source).toContain('module="design"');
    expect(source).toContain("EpisodeAssetDesignWorkspace");
  });

  it("library page mounts shell nav and embedded AssetManagementWorkspace", () => {
    const source = readSrc(
      "src/app/app/projects/[projectId]/assets/library/page.tsx",
    );
    expect(source).toContain("ProjectAssetsManagementPage");
    expect(source).toContain('module="library"');
    expect(source).toContain("AssetManagementWorkspace");
    expect(source).toContain("embedded");
  });

  it("workspace assets entry sends all asset roles to design (CE included)", () => {
    const entry = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/page.tsx",
    );
    expect(entry).toContain("router.replace");
    expect(entry).toContain("workspaceProjectAssetsDesignPath");
    expect(entry).not.toContain("workspaceProjectAssetsLibraryPath");

    const library = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/library/page.tsx",
    );
    expect(library).toContain("WorkspaceAssetsPage");
    expect(library).toContain("AssetManagementWorkspace");
    expect(library).toContain('context="workspace"');

    const design = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/design/page.tsx",
    );
    expect(design).toContain("EpisodeAssetDesignWorkspace");
    expect(design).not.toContain("查看资产库");

    const designLayout = readSrc(
      "src/app/app/workspace/projects/[projectId]/assets/design/layout.tsx",
    );
    expect(designLayout).toContain("assertWorkspaceAssetDesignPage");

    const pageGuards = readSrc("src/auth/page-guards.ts");
    expect(pageGuards).not.toContain("denied=design");
  });

  it("AssetModuleNav supports workspace basePath and showDesign", () => {
    const source = readSrc("src/projects/assets/AssetModuleNav.tsx");
    expect(source).toContain("workspaceProjectAssetsPath");
    expect(source).toContain("showDesign");
    expect(source).toContain("资产设计确认");
    expect(source).toContain("资产库");
  });

  it("project management detail links assets stage to design", () => {
    const source = readSrc(
      path.join("src", "app", "app", "projects", "[projectId]", "page.tsx"),
    );
    expect(source).toContain("/assets/design");
    expect(source).toContain('data-testid="stage-assets"');
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
    expect(source).toContain("AudioCreateDialog");
    expect(source).toContain("pendingMedia");
    expect(source).toContain("createdAssets");
  });

  it("story-generation-client supports episode_asset_design outputKind", () => {
    const source = readSrc("src/projects/story/story-generation-client.ts");
    expect(source).toContain("episode_asset_design");
    expect(source).toContain("episodeId");
  });
});
