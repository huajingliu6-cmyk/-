import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("workbench vs canvas route wiring", () => {
  it("platform workspace page does not mount WorkflowEditor or ReactFlow", () => {
    const source = readSrc("src/app/app/workspace/page.tsx");
    expect(source).toContain("工作台");
    expect(source).toContain("platform-workbench");
    expect(source).not.toContain("WorkflowEditor");
    expect(source).not.toContain("ReactFlow");
    expect(source).toContain("workspaceProjectPath");
    expect(source).not.toContain("前往项目管理");
  });

  it("workflow page mounts WorkflowEditor only after server gate", () => {
    const page = readSrc("src/app/workflow/page.tsx");
    const client = readSrc("src/app/workflow/WorkflowCanvasClient.tsx");
    expect(page).toContain("requireVideoCanvasAccess");
    expect(page).toContain("WorkflowCanvasClient");
    expect(page).not.toContain("DEMO_PROJECT_ID");
    expect(page).toContain("workflow-forbidden");
    expect(client).toContain("WorkflowEditor");
    expect(client).toContain("视频制作画布");
  });

  it("project management page keeps script stage and members", () => {
    const source = readSrc(
      path.join("src", "app", "app", "projects", "[projectId]", "page.tsx"),
    );
    expect(source).toContain("项目工作台");
    expect(source).toContain("剧本创作");
    expect(source).toContain("ProjectMembersPanel");
    expect(source).not.toContain("WorkflowEditor");
  });

  it("projects list opens management project path, not canvas", () => {
    const source = readSrc("src/app/app/projects/page.tsx");
    expect(source).toContain("projectWorkbenchPath");
    expect(source).not.toContain("/app/workspace?projectId");
    expect(source).not.toContain("/workflow?projectId");
  });

  it("assets start creation still targets storyboard in management context", () => {
    const source = readSrc(
      "src/projects/assets/AssetManagementWorkspace.tsx",
    );
    expect(source).toContain("/storyboard");
    expect(source).toContain("开始创作");
    expect(source).not.toMatch(
      /开始创作[\s\S]{0,400}\/workflow/,
    );
  });

  it("create wizard canvas shortcut opens project management path", () => {
    const source = readSrc(
      "src/projects/components/CreateProjectWizardDialog.tsx",
    );
    expect(source).toContain("/app/projects/");
    expect(source).not.toContain("/app/workspace?projectId");
  });
});
