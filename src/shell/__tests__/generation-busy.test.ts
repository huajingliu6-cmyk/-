import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  beginGenerationBusy,
  clearGenerationBusyForTests,
  confirmGenerationLeaveIfNeeded,
  getGenerationBusySummary,
  isGenerationBusy,
} from "@/shell/generation-busy";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("generation-busy registry", () => {
  beforeEach(() => {
    clearGenerationBusyForTests();
  });

  it("tracks begin/end and summary", () => {
    expect(isGenerationBusy()).toBe(false);
    const end = beginGenerationBusy("t1", "资产提取");
    expect(isGenerationBusy()).toBe(true);
    expect(getGenerationBusySummary()).toBe("资产提取");
    end();
    expect(isGenerationBusy()).toBe(false);
  });

  it("blocks leave while busy when no UI is bound", async () => {
    const end = beginGenerationBusy("t2", "分镜提示词生成");
    expect(await confirmGenerationLeaveIfNeeded()).toBe(false);
    end();
    expect(await confirmGenerationLeaveIfNeeded()).toBe(true);
  });
});

describe("generation-busy wiring contracts", () => {
  it("shell and stage nav intercept navigation while generating", () => {
    const back = readSrc("src/shell/GlobalBackButton.tsx");
    const nav = readSrc("src/shell/AuthenticatedNavigation.tsx");
    const stage = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    const shell = readSrc("src/shell/AuthenticatedAppShell.tsx");
    expect(back).toContain("confirmGenerationLeaveIfNeeded");
    expect(nav).toContain("isGenerationBusy");
    expect(nav).toContain("confirmGenerationLeaveIfNeeded");
    expect(stage).toContain("isGenerationBusy");
    expect(shell).toContain("GenerationBusyGuard");
  });

  it("generation surfaces register useGenerationBusy", () => {
    const story = readSrc("src/projects/story/StoryCreationWorkspace.tsx");
    const assets = readSrc(
      "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
    );
    const storyboard = readSrc(
      "src/projects/storyboard/components/StoryboardProductionPanel.tsx",
    );
    const script = readSrc("src/projects/script/ScriptCreationWorkspace.tsx");
    expect(story).toContain("useGenerationBusy");
    expect(assets).toContain("useGenerationBusy");
    expect(storyboard).toContain("useGenerationBusy");
    expect(script).toContain("useGenerationBusy");
  });

  it("asset extract overlay is restored by GenerationBusyGuard", () => {
    const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
    expect(guard).toContain("asset-extraction");
    expect(guard).toContain("资产提取");
    expect(guard).toContain("beginGenerationBusy");
  });
});
