import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("script downstream pipeline contracts", () => {
  it("allows entering storyboard while prompts are queued or generating", () => {
    const pipeline = readSrc("src/projects/script/script-downstream-pipeline.ts");
    const guard = readSrc("src/projects/script/ScriptDownstreamPipelineGuard.tsx");
    const storyboard = readSrc(
      "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
    );
    const stageNav = readSrc("src/projects/workbench/ProjectStageNavLinks.tsx");

    expect(pipeline).toContain("canEnterStoryboard: true");
    expect(pipeline).not.toContain("分镜正在排队生成，请稍候");
    expect(pipeline).toContain("isStoryboardGeneratingLockActive");
    expect(guard).toContain("pipeline.extractingAssets");
    expect(guard).not.toContain("storyboard-pipeline");
    expect(storyboard).toContain("storyboard-pipeline-banner");
    expect(storyboard).toContain("storyboard-pipeline-banner-dismiss");
    expect(storyboard).toContain("关闭提示");
    expect(storyboard).toContain('pipeline.phase === "ready"');
    expect(stageNav).toContain("shouldBlockGenerationLeave(stage.href)");
  });
});
