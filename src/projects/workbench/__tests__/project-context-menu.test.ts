import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("project management context menu", () => {
  const projectsPage = readSrc("src/app/app/projects/page.tsx");
  const workspacePage = readSrc("src/app/app/workspace/page.tsx");
  const menu = readSrc(
    "src/projects/workbench/WorkbenchProjectContextMenu.tsx",
  );
  const css = readSrc("src/app/app/projects/projects.css");
  const route = readSrc("src/app/api/projects/[projectId]/route.ts");

  it("wires right-click edit actions on project management cards", () => {
    expect(projectsPage).toContain("onContextMenu");
    expect(projectsPage).toContain("WorkbenchProjectContextMenu");
    expect(projectsPage).toContain("project-rename-dialog");
    expect(menu).toContain("重命名");
    expect(menu).toContain("删除项目");
    expect(menu).toContain("编辑项目规则");
    expect(projectsPage).toContain("ProjectRulesDialog");
    expect(projectsPage).not.toContain("lumina:open-api-manage");
    expect(css).toContain(".wb-context-menu");
  });

  it("shows only new project on blank personal project-list space", () => {
    expect(projectsPage).toContain("PersonalBlankContextMenu");
    expect(projectsPage).toContain("activeSpace.kind !== \"personal\"");
    expect(projectsPage).toContain("[data-testid='project-management-card']");
    expect(readSrc("src/projects/workbench/PersonalBlankContextMenu.tsx")).toContain(
      'data-testid="personal-blank-ctx-create"',
    );
    expect(readSrc("src/projects/workbench/PersonalBlankContextMenu.tsx")).not.toContain(
      "重命名项目",
    );
  });

  it("does not allow editing from workbench cards", () => {
    expect(workspacePage).not.toContain("onContextMenu");
    expect(workspacePage).not.toContain("WorkbenchProjectContextMenu");
    expect(workspacePage).not.toContain("rename");
    expect(workspacePage).not.toContain("DELETE");
  });

  it("supports rename and delete on project API", () => {
    expect(route).toContain("updateProjectName");
    expect(route).toContain("deleteProjectRecord");
    expect(route).toContain("export async function DELETE");
  });
});
