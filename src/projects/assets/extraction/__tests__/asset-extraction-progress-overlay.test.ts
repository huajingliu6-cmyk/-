import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildAssetExtractionProgress,
  footerLinesForProgress,
  subtitleForProgressPhase,
} from "@/projects/assets/extraction/progress-view";
import { toPublicExtractionTask } from "@/projects/assets/extraction/public-task";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function baseTask(
  patch: Partial<AssetExtractionTask> = {},
): AssetExtractionTask {
  const now = new Date().toISOString();
  return {
    id: "task_1",
    projectId: "p1",
    taskKey: "p1:fp:all-assets",
    sourceFingerprint: "fp",
    scope: "all",
    episodeId: null,
    modelKey: "deepseek-v4-pro",
    status: "extracting_details",
    stage: "extracting_details",
    estimatedProgress: 40,
    revision: 1,
    errorMessage: null,
    versionId: "ver_1",
    createdAt: now,
    updatedAt: now,
    roster: [
      {
        assetKey: "character:甲",
        type: "character",
        name: "甲",
        aliases: [],
        episodeIds: ["ep1"],
        evidenceRefs: [],
      },
      {
        assetKey: "character:乙",
        type: "character",
        name: "乙",
        aliases: [],
        episodeIds: ["ep1"],
        evidenceRefs: [],
      },
    ],
    detailItems: [
      {
        assetKey: "character:甲",
        name: "甲",
        status: "completed",
        attempt: 1,
        batchIndex: 1,
      },
      {
        assetKey: "character:乙",
        name: "乙",
        status: "pending",
        attempt: 0,
      },
    ],
    rosterCompletedChunkIds: ["c1", "c2"],
    rosterChunksTotal: 2,
    ...patch,
  };
}

describe("asset extraction progress view", () => {
  it("builds refresh-safe progress from persisted task fields", () => {
    const progress = buildAssetExtractionProgress(baseTask(), {
      rosterChunksTotal: 2,
    });
    expect(progress.phase).toBe("extracting_details");
    expect(progress.roster.discoveredCount).toBe(2);
    expect(progress.details.completedAssets).toBe(1);
    expect(progress.details.totalAssets).toBe(2);
    expect(progress.estimatedProgress).toBeGreaterThanOrEqual(15);
    expect(progress.estimatedProgress).toBeLessThan(90);
  });

  it("exposes progress on the public task without failure diagnostics", () => {
    const publicTask = toPublicExtractionTask(
      baseTask({
        detailItems: [
          {
            assetKey: "character:甲",
            name: "甲",
            status: "completed",
            attempt: 1,
            batchIndex: 1,
          },
          {
            assetKey: "character:乙",
            name: "乙",
            status: "terminal_failed",
            attempt: 2,
            batchIndex: 1,
            errorMessage: "secret",
          },
        ],
      }),
    );
    expect(publicTask.progress.details.completedAssets).toBe(1);
    expect(publicTask.progress.details.totalAssets).toBe(2);
    expect(JSON.stringify(publicTask)).not.toContain("secret");
    expect(JSON.stringify(publicTask)).not.toContain("terminal_failed");
  });

  it("uses neutral subtitles and footers without failure lists", () => {
    expect(subtitleForProgressPhase("retrying_failed_once")).toContain("补全");
    const lines = footerLinesForProgress(
      buildAssetExtractionProgress(
        baseTask({
          status: "retrying_failed_once",
          stage: "retrying_failed_once",
        }),
      ),
    );
    expect(lines.join("\n")).not.toContain("失败");
    expect(lines.some((line) => line.includes("自动进入资产页"))).toBe(true);
  });
});

describe("extraction overlay contracts", () => {
  it("renders richer overlay structure without fake progress climbing", () => {
    const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
    const css = readSrc("src/shell/shell.css");
    expect(guard).toContain("asset-extraction-overlay-steps");
    expect(guard).toContain("asset-extraction-overlay-stats");
    expect(guard).toContain("已发现资产");
    expect(guard).toContain("已完成详情");
    expect(guard).not.toContain("smoothProgress");
    expect(guard).not.toContain("通常需要");
    expect(guard).not.toContain("取消生成");
    expect(css).toContain("min(680px, calc(100vw - 40px))");
    expect(css).toContain("min-height: 420px");
  });
});
