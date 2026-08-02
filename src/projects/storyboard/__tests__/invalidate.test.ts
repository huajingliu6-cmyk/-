import { describe, expect, it } from "vitest";
import {
  invalidateAfterScriptChange,
  invalidateOnAssetsReconfirm,
} from "@/projects/storyboard/services/invalidate";
import type { EpisodeProduction } from "@/projects/storyboard/types";

function baseProduction(
  overrides: Partial<EpisodeProduction> = {},
): EpisodeProduction {
  const now = new Date().toISOString();
  return {
    id: "prod1",
    projectId: "p1",
    episodeId: "ep1",
    episodeNumber: 1,
    currentStep: 2,
    status: "storyboard_review",
    workingScriptText: "剧本A",
    workingScriptRevision: 2,
    confirmedScriptText: "剧本A",
    confirmedScriptRevision: 2,
    confirmedScriptHash: "hash",
    scriptConfirmedAt: now,
    scriptConfirmedBy: "u1",
    assetMatches: [
      {
        id: "m1",
        assetType: "character",
        extractedName: "林清",
        normalizedName: "林清",
        occurrences: 1,
        firstOffset: 0,
        otherOffsets: [],
        matchedAssetId: "c1",
        matchedAssetName: "林清",
        matchedAssetRevision: 1,
        confidence: "high",
        matchSource: "manual",
        resolution: "matched",
        locked: true,
        confirmed: true,
        revision: 1,
      },
    ],
    confirmedAssetSnapshotHash: "asset-hash",
    assetsConfirmedAt: now,
    assetsConfirmedBy: "u1",
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: {
      id: "sb1",
      version: 1,
      status: "ready",
      sourceScriptHash: "hash",
      sourceAssetSnapshotHash: "asset-hash",
      generationJobId: "mock_job_1",
      scenes: [],
      videoHistoryGenerationIds: [],
      confirmedAt: null,
      confirmedBy: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    generationError: null,
    videoGenerationBatch: null,
    revision: 5,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("invalidate services", () => {
  it("marks storyboard stale but keeps shots editable", () => {
    const next = invalidateAfterScriptChange(baseProduction());
    expect(next.assetsStale).toBe(true);
    expect(next.storyboardStale).toBe(true);
    expect(next.currentStep).toBe(2);
    expect(next.status).toBe("storyboard_incomplete");
    expect(next.activeStoryboard?.status).toBe("stale");
    expect(next.assetsConfirmedAt).toBeNull();
    expect(next.confirmedAssetSnapshotHash).toBeNull();
    expect(next.assetMatches).toHaveLength(1);
  });

  it("does not invent stale flags on pure step-1 drafts", () => {
    const next = invalidateAfterScriptChange(
      baseProduction({
        currentStep: 1,
        status: "awaiting_script",
        confirmedScriptText: null,
        confirmedScriptRevision: null,
        confirmedScriptHash: null,
        scriptConfirmedAt: null,
        scriptConfirmedBy: null,
        assetMatches: [],
        assetsConfirmedAt: null,
        assetsConfirmedBy: null,
        confirmedAssetSnapshotHash: null,
        activeStoryboard: null,
      }),
    );
    expect(next.assetsStale).toBe(false);
    expect(next.storyboardStale).toBe(false);
    expect(next.currentStep).toBe(1);
  });

  it("marks storyboard stale after assets reconfirm", () => {
    const next = invalidateOnAssetsReconfirm(baseProduction());
    expect(next.storyboardStale).toBe(true);
    expect(next.activeStoryboard?.status).toBe("stale");
    expect(next.assetsStale).toBe(false);
  });
});
