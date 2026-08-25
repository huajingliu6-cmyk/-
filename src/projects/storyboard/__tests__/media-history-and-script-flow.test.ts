import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("media history strip layout", () => {
  it("uses shared MediaHistoryStrip in design modal and image edit panel", () => {
    const modal = readSrc("src/projects/assets/DesignAssetModal.tsx");
    const panel = readSrc("src/projects/assets/AssetImageEditPanel.tsx");
    const strip = readSrc("src/projects/ui/MediaHistoryStrip.tsx");
    const css = readSrc("src/projects/ui/media-history-strip.css");

    expect(modal).toContain('from "@/projects/ui/MediaHistoryStrip"');
    expect(modal).toContain("MediaHistoryStrip");
    expect(modal).toContain('testId="design-image-history"');
    expect(panel).toContain('testId="aie-image-history"');
    expect(strip).toContain("media-history-strip__grid");
    expect(strip).toContain("media-history-strip__counter");
    expect(strip).toContain("0/${maxVisible}");
  });

  it("keeps storyboard shot cards on the shared strip", () => {
    const card = readSrc("src/projects/storyboard/components/ShotAssetCard.tsx");
    expect(card).toContain('from "@/projects/ui/MediaHistoryStrip"');
  });
});

describe("script confirm one-click downstream pipeline", () => {
  it("stays on script page with extract-on-storyboard guidance after confirm", () => {
    const workspace = readSrc("src/projects/script/ScriptCreationWorkspace.tsx");
    const runTask = readSrc("src/projects/assets/extraction/run-task.ts");
    const pipeline = readSrc(
      "src/projects/storyboard/services/episode-extraction-downstream.ts",
    );

    expect(workspace).toContain("[storyboard] confirm-script");
    expect(workspace).toContain("提取本集资产");
    expect(workspace).toContain("自动入库并生成分镜提示词");
    expect(runTask).toContain("runEpisodeExtractionDownstream");
    expect(pipeline).toContain("autoPromoteEpisodeExtractionResults");
    expect(pipeline).toContain("generateStoryboardEpisode");
  });
});
