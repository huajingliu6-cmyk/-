import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";
import {
  isRunnerHeartbeatStale,
  isRunnerLeaseActive,
} from "@/projects/assets/extraction/runner-lease";
import { toPublicExtractionTask } from "@/projects/assets/extraction/public-task";
import { collectProviderText } from "@/projects/assets/extraction/pipeline/pool";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

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
    estimatedProgress: 15,
    revision: 1,
    errorMessage: null,
    versionId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe("asset extraction runner lease / resume", () => {
  it("treats missing or expired lease as inactive", () => {
    expect(isRunnerLeaseActive(baseTask({ runnerLeaseUntil: null }))).toBe(
      false,
    );
    expect(
      isRunnerLeaseActive(
        baseTask({
          runnerLeaseUntil: new Date(Date.now() - 1_000).toISOString(),
        }),
      ),
    ).toBe(false);
    expect(
      isRunnerLeaseActive(
        baseTask({
          runnerLeaseUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
    ).toBe(true);
  });

  it("marks live tasks stale when heartbeat is older than policy", () => {
    const staleStamp = new Date(
      Date.now() - ASSET_EXTRACTION_POLICY.runnerStaleMs - 1_000,
    ).toISOString();
    expect(
      isRunnerHeartbeatStale(
        baseTask({
          heartbeatAt: staleStamp,
          updatedAt: staleStamp,
        }),
      ),
    ).toBe(true);
    expect(
      isRunnerHeartbeatStale(
        baseTask({
          heartbeatAt: new Date().toISOString(),
        }),
      ),
    ).toBe(false);
  });

  it("exposes runnerStale on public task for recovering UI", () => {
    const staleStamp = new Date(
      Date.now() - ASSET_EXTRACTION_POLICY.runnerStaleMs - 5_000,
    ).toISOString();
    const publicTask = toPublicExtractionTask(
      baseTask({
        heartbeatAt: staleStamp,
        updatedAt: staleStamp,
        progress: {
          phase: "extracting_details",
          estimatedProgress: 15,
          roster: { scannedChunks: 1, totalChunks: 1, discoveredCount: 23 },
          details: {
            totalAssets: 23,
            completedAssets: 0,
            runningBatches: 1,
            completedBatches: 0,
            totalBatches: 5,
            retryRound: 0,
          },
        },
      }),
    );
    expect(publicTask.runnerStale).toBe(true);
    expect(publicTask.estimatedProgress).toBe(15);
    expect(publicTask.progress.details.completedAssets).toBe(0);
    expect(publicTask.progress.details.totalAssets).toBe(23);
  });

  it("times out hung model streams with MODEL_TIMEOUT", async () => {
    const provider: TextGenerationProvider = {
      id: "test",
      async *streamText() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield { type: "delta", text: "late" } satisfies ProviderTextStreamEvent;
      },
    };
    const result = await collectProviderText({
      provider,
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "m",
      maxOutputTokens: 100,
      timeoutMs: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MODEL_TIMEOUT");
  });

  it("wires resume into snapshot GET and runner lease into run-task", () => {
    const snapshot = readSrc("src/projects/assets/extraction/snapshot.ts");
    const resume = readSrc("src/projects/assets/extraction/resume.ts");
    const runTask = readSrc("src/projects/assets/extraction/run-task.ts");
    const details = readSrc(
      "src/projects/assets/extraction/pipeline/details.ts",
    );
    const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
    const instrumentation = readSrc("src/instrumentation.ts");

    expect(snapshot).toContain("resumeLiveAssetExtractionTask");
    expect(resume).toContain("dispatchAssetExtractionRunner");
    expect(resume).toContain("isRunnerLeaseActive");
    expect(runTask).toContain("claimAssetExtractionRunnerLease");
    expect(runTask).toContain("renewAssetExtractionRunnerLease");
    expect(runTask).toContain("onHeartbeat");
    expect(details).toContain("detailBatchTimeoutMs");
    expect(details).toContain("onHeartbeat");
    expect(details).toContain("runnerHeartbeatMs");
    expect(guard).toContain("提取任务正在恢复");
    expect(guard).toContain("恢复任务");
    expect(guard).toContain("取消任务");
    expect(guard).toContain("/cancel");
    expect(instrumentation).toContain("resumeLiveAssetExtractionTask");
  });

  it("keeps cancel routes for management and workspace", () => {
    expect(
      readSrc(
        "src/app/api/projects/[projectId]/asset-extraction/tasks/[taskId]/cancel/route.ts",
      ),
    ).toContain("handleCancelAssetExtraction");
    expect(
      readSrc(
        "src/app/api/workspace/projects/[projectId]/asset-extraction/tasks/[taskId]/cancel/route.ts",
      ),
    ).toContain("handleCancelAssetExtraction");
  });
});
