import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("one stack flow entry contracts", () => {
  it("keeps sidebar entry below canvas and routes through project management", () => {
    const sidebar = readSrc("src/shell/AppSidebar.tsx");
    const hook = readSrc("src/shell/use-open-one-stack-flow.tsx");
    expect(sidebar).toContain("一栈式FLOW");
    expect(sidebar).toContain("app-sidebar-one-stack-flow");
    expect(sidebar).toContain("GitBranch");

    const personalIdx = sidebar.indexOf('label: "个人素材"');
    const marketIdx = sidebar.indexOf('label: "素材市场"');
    const canvasIdx = sidebar.indexOf('label: "画布"');
    const flowIdx = sidebar.indexOf('label: "一栈式FLOW"');
    expect(personalIdx).toBeGreaterThan(-1);
    expect(marketIdx).toBeGreaterThan(personalIdx);
    expect(canvasIdx).toBeGreaterThan(marketIdx);
    expect(flowIdx).toBeGreaterThan(canvasIdx);

    expect(hook).toContain("/api/projects/");
    expect(hook).toContain("/entry");
    expect(hook).toContain("APP_PROJECTS_PATH");
    expect(hook).not.toContain("ProjectPickerDialog");
    expect(hook).not.toContain("/app/one-stack-flow");
  });

  it("canvas sidebar entry routes to infinite canvas project list", () => {
    const hook = readSrc("src/shell/use-open-canvas.tsx");
    const sidebar = readSrc("src/shell/AppSidebar.tsx");
    expect(hook).toContain("APP_INFINITE_CANVAS_PATH");
    expect(hook).not.toContain("ProjectPickerDialog");
    expect(sidebar).toContain('action: "canvas"');
  });

  it("brands project stage nav with project name when header flow is unavailable", () => {
    const nav = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    const layout = readSrc("src/app/app/projects/[projectId]/layout.tsx");
    const workspaceLayout = readSrc(
      "src/app/app/workspace/projects/[projectId]/layout.tsx",
    );
    expect(nav).toContain("brandLabel");
    expect(nav).toContain("if (flowHeader) {");
    expect(nav).toContain("return null");
    expect(layout).toContain("ProjectFlowHeaderSeed");
    expect(layout).toContain("projectName={gated.project.name}");
    expect(workspaceLayout).toContain("brandLabel={project?.name");
  });

  it("uses flow-specific branding and in-progress filters on project lists", () => {
    const page = readSrc("src/projects/ui/ProjectFlowListPage.tsx");
    const projects = readSrc("src/app/app/projects/page.tsx");
    const infinite = readSrc("src/app/app/infinite-canvas/page.tsx");
    expect(page).toContain("flow.projectMode");
    expect(page).toContain("flow.title");
    expect(projects).toContain("FULL_STACK_FLOW");
    expect(page).toContain("requireScriptUpload={flow.kind === \"full-stack\"}");
    expect(page).toContain("listFlowKind={flow.kind}");
    expect(page).not.toContain("showOptionalCanvas");
    expect(infinite).toContain("INFINITE_CANVAS_FLOW");
    expect(page).toContain('"in_progress"');
    expect(page).toContain("进行中");
  });

  it("does not ship a standalone one-stack flow page", () => {
    expect(() => readSrc("src/app/app/one-stack-flow/page.tsx")).toThrow();
    expect(() => readSrc("src/one-stack-flow/ui/OneStackFlowClient.tsx")).toThrow();
  });

  it("shows project stage nav in the global header on project detail routes", () => {
    const shell = readSrc("src/shell/AuthenticatedAppShell.tsx");
    const header = readSrc("src/shell/AuthenticatedHeader.tsx");
    const nav = readSrc("src/shell/nav.ts");
    const stage = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    const links = readSrc("src/projects/workbench/ProjectStageNavLinks.tsx");
    expect(shell).toContain("ProjectFlowHeaderShell");
    expect(header).toContain("ShellProjectContext");
    expect(header).toContain("ProjectStageNavLinks");
    expect(header).toContain('placement="header"');
    expect(header).toContain("isOneStackFlowPath");
    expect(header).toContain("hideGlobalNav");
    expect(nav).toContain("parseProjectFlowRoute");
    expect(stage).toContain("useProjectFlowHeader");
    expect(links).toContain("01");
    expect(links).toContain("剧本创作");
    expect(shell).toContain('variant={headerVariant}');
    expect(nav).not.toContain('label: "素材引擎"');
  });
});
