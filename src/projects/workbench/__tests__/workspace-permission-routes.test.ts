import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("workspace permission route wiring", () => {
  it("workspace home cards open workspace assets path", () => {
    const source = readSrc("src/app/app/workspace/page.tsx");
    expect(source).toContain("workspaceProjectAssetsPath");
    expect(source).toContain("/api/workspace/projects");
    expect(source).not.toContain("前往项目管理");
    expect(source).not.toContain("APP_PROJECTS_PATH");
  });

  it("workspace project root redirects to assets and has no overview shell", () => {
    const source = readSrc(
      path.join("src", "app", "app", "workspace", "projects", "[projectId]", "page.tsx"),
    );
    const layout = readSrc(
      path.join("src", "app", "app", "workspace", "projects", "[projectId]", "layout.tsx"),
    );
    const nav = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    expect(source).toContain("workspaceProjectAssetsPath");
    expect(source).toContain("redirect(");
    expect(source).not.toContain("工作台项目");
    expect(source).not.toContain("workspace-project-page");
    expect(source).not.toContain("剧本创作");
    expect(source).not.toContain("wb-stage");
    expect(layout).toContain('mode="workspace"');
    expect(nav).toContain('project-stage-nav--${mode}');
    expect(nav).toContain("一栈式Flow");
    expect(nav).toContain('label: "项目资产"');
    expect(nav).toContain('label: "分镜创作"');
    expect(source).not.toContain("前往项目管理");
    expect(source).not.toContain("返回项目管理");
  });

  it("workspace assets entry redirects to design for all asset roles; library and design modules exist", () => {
    const entry = readSrc(
      path.join(
        "src",
        "app",
        "app",
        "workspace",
        "projects",
        "[projectId]",
        "assets",
        "page.tsx",
      ),
    );
    expect(entry).toContain("workspaceProjectAssetsDesignPath");
    expect(entry).not.toContain("workspaceProjectAssetsLibraryPath");
    expect(entry).toContain("router.replace");

    const library = readSrc(
      path.join(
        "src",
        "app",
        "app",
        "workspace",
        "projects",
        "[projectId]",
        "assets",
        "library",
        "page.tsx",
      ),
    );
    expect(library).toContain("WorkspaceAssetsPage");
    expect(library).toContain("AssetManagementWorkspace");
    expect(library).not.toContain("EpisodeAssetDesignWorkspace");
    expect(library).toContain('context="workspace"');

    const design = readSrc(
      path.join(
        "src",
        "app",
        "app",
        "workspace",
        "projects",
        "[projectId]",
        "assets",
        "design",
        "page.tsx",
      ),
    );
    expect(design).toContain("EpisodeAssetDesignWorkspace");
    expect(design).toContain("WorkspaceAssetsPage");

    const designLayout = readSrc(
      path.join(
        "src",
        "app",
        "app",
        "workspace",
        "projects",
        "[projectId]",
        "assets",
        "design",
        "layout.tsx",
      ),
    );
    expect(designLayout).toContain("assertWorkspaceAssetDesignPage");

    const pageGuards = readSrc("src/auth/page-guards.ts");
    expect(pageGuards).not.toContain("denied=design");
    expect(pageGuards).toMatch(
      /assertWorkspaceAssetDesignPage[\s\S]*assertWorkspaceAssetPage/,
    );
  });

  it("workspace storyboard page stays under workspace and reuses StoryboardCreationWorkspace", () => {
    const page = readSrc(
      path.join(
        "src",
        "app",
        "app",
        "workspace",
        "projects",
        "[projectId]",
        "storyboard",
        "page.tsx",
      ),
    );
    const api = readSrc(
      path.join("src", "app", "api", "workspace", "projects", "[projectId]", "route.ts"),
    );
    expect(page).toContain('context="workspace"');
    expect(page).toContain("StoryboardCreationWorkspace");
    expect(page).not.toContain("/app/projects/");
    expect(api).toContain("workspaceProjectStoryboardPath");
    expect(api).not.toMatch(
      /storyboard[\s\S]{0,200}\/app\/projects\//,
    );
  });

  it("asset workspace no longer shows start creation button", () => {
    const source = readSrc(
      "src/projects/assets/AssetManagementWorkspace.tsx",
    );
    expect(source).toContain('context === "workspace"');
    expect(source).not.toContain("开始创作");
    expect(source).not.toContain("handleStartCreation");
  });
});
