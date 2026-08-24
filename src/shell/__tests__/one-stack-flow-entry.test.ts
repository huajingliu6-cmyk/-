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

  it("brands project stage nav as one-stack without new routes", () => {
    const nav = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    expect(nav).toContain("一栈式Flow");
    expect(nav).toContain('step: "01"');
    expect(nav).toContain('label: "剧本创作"');
    expect(nav).toContain('label: "项目资产"');
    expect(nav).toContain('label: "分镜创作"');
    expect(nav).toContain("/app/projects/");
    expect(nav).not.toContain("/app/one-stack-flow");
  });

  it("does not ship a standalone one-stack flow page", () => {
    expect(() => readSrc("src/app/app/one-stack-flow/page.tsx")).toThrow();
    expect(() => readSrc("src/one-stack-flow/ui/OneStackFlowClient.tsx")).toThrow();
  });

  it("hides top shell navigation on one-stack flow routes", () => {
    const shell = readSrc("src/shell/AuthenticatedAppShell.tsx");
    const nav = readSrc("src/shell/nav.ts");
    expect(shell).toContain("isOneStackFlowPath");
    expect(shell).toContain("hideTopChrome");
    expect(nav).not.toContain('label: "素材引擎"');
    expect(nav).toContain('label: "一栈式Flow"');
  });

  it("uses one-stack branding and in-progress filters on projects page", () => {
    const page = readSrc("src/app/app/projects/page.tsx");
    expect(page).toContain("<h1>一栈式Flow</h1>");
    expect(page).toContain('"in_progress"');
    expect(page).toContain("进行中");
    expect(page).not.toContain('id: "draft"');
    expect(page).not.toContain('id: "generating"');
    expect(page).not.toContain('id: "failed"');
  });
});
