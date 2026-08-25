import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  isOneStackProjectStagePath,
  parseProjectFlowRoute,
} from "@/shell/nav";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("one-stack project header context", () => {
  it("limits flow header to script, story, assets and storyboard routes", () => {
    expect(isOneStackProjectStagePath("/app/projects/p1/script")).toBe(true);
    expect(isOneStackProjectStagePath("/app/projects/p1/story")).toBe(true);
    expect(isOneStackProjectStagePath("/app/projects/p1/assets/library")).toBe(
      true,
    );
    expect(isOneStackProjectStagePath("/app/projects/p1/storyboard")).toBe(
      true,
    );
    expect(isOneStackProjectStagePath("/app/projects/p1")).toBe(false);
    expect(isOneStackProjectStagePath("/app/projects/p1/breakdown")).toBe(false);
    expect(isOneStackProjectStagePath("/app/projects")).toBe(false);
    expect(parseProjectFlowRoute("/app/projects/p1/script")).toEqual({
      projectId: "p1",
      mode: "management",
    });
  });

  it("shows project name in header instead of Lumina Story on stage routes", () => {
    const header = readSrc("src/shell/AuthenticatedHeader.tsx");
    const context = readSrc("src/shell/ShellProjectContext.tsx");
    const shell = readSrc("src/shell/ProjectFlowHeaderShell.tsx");
    const layout = readSrc("src/app/app/projects/[projectId]/layout.tsx");
    expect(header).toContain("ShellProjectContext");
    expect(header).toContain("flowHeader.projectName");
    expect(header).toContain("shell-header--project-flow");
    expect(context).toContain("shell-project-context__name");
    expect(context).toContain('data-testid="shell-project-context"');
    expect(shell).toContain("isOneStackProjectStagePath");
    expect(shell).toContain("ProjectFlowHeaderSeed");
    expect(layout).toContain("ProjectFlowHeaderSeed");
    expect(layout).toContain("projectName={gated.project.name}");
  });

  it("hides inline stage nav brand when header flow is active", () => {
    const nav = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    expect(nav).toContain("if (flowHeader) {");
    expect(nav).toContain("return null");
  });
});
