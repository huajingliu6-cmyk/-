import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { persistProduction } from "@/projects/storyboard/api-helpers";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  StoryboardDocument,
} from "@/projects/storyboard/types";

function board(id: string): StoryboardDocument {
  return {
    id,
    projectId: "p_keep",
    episodeId: id.startsWith("a") ? "ep_a" : "ep_b",
    sourceScriptHash: "s",
    sourceAssetSnapshotHash: "a",
    scenes: [
      {
        id: `scene_${id}`,
        title: "场景",
        shots: [
          {
            id: `shot_${id}`,
            episodeShotNumber: 1,
            title: "镜头",
            description: "描述",
            durationHintSec: 3,
            assetRequirements: [],
            videoPrompt: "提示词",
            promptLocked: false,
            locked: false,
            revision: 1,
          },
        ],
      },
    ],
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function production(
  episodeId: string,
  episodeNumber: number,
  activeStoryboard: StoryboardDocument | null,
): EpisodeProduction {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: `prod_${episodeId}`,
    projectId: "p_keep",
    episodeId,
    episodeNumber,
    currentStep: 2,
    status: activeStoryboard ? "storyboard_incomplete" : "awaiting_storyboard",
    workingScriptText: "剧本",
    workingScriptRevision: 1,
    confirmedScriptText: "剧本",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "hash",
    scriptConfirmedAt: now,
    scriptConfirmedBy: "u1",
    assetMatches: [],
    confirmedAssetSnapshotHash: "snap",
    assetsConfirmedAt: now,
    assetsConfirmedBy: "u1",
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard,
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("persistProduction keeps sibling storyboards", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-keep-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("saving episode B does not wipe episode A activeStoryboard", async () => {
    const boardA = board("a1");
    const boardB = board("b1");
    const initial: ProjectStoryboardWorkspace = {
      projectId: "p_keep",
      activeEpisodeId: "ep_a",
      productions: [
        production("ep_a", 1, boardA),
        production("ep_b", 2, null),
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await saveWorkspace(initial);

    // Stale in-memory snapshot that still thinks A has no board (the old bug).
    const staleSnapshot: ProjectStoryboardWorkspace = {
      projectId: "p_keep",
      activeEpisodeId: "ep_b",
      productions: [
        production("ep_a", 1, null),
        production("ep_b", 2, null),
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await persistProduction(staleSnapshot, {
      ...production("ep_b", 2, boardB),
      revision: 2,
    });

    const loaded = await loadWorkspace("p_keep");
    expect(loaded?.productions).toHaveLength(2);
    const epA = loaded?.productions.find((p) => p.episodeId === "ep_a");
    const epB = loaded?.productions.find((p) => p.episodeId === "ep_b");
    expect(epA?.activeStoryboard?.id).toBe("a1");
    expect(epB?.activeStoryboard?.id).toBe("b1");
  });

  it("keeps production row when activeStoryboard payload is invalid", () => {
    const ws = normalizeWorkspace("p_keep", {
      productions: [
        {
          id: "prod_bad",
          episodeId: "ep_a",
          episodeNumber: 1,
          status: "storyboard_incomplete",
          workingScriptText: "剧本",
          activeStoryboard: { totally: "invalid" },
        },
      ],
      activeEpisodeId: "ep_a",
    });
    expect(ws?.productions).toHaveLength(1);
    expect(ws?.productions[0]?.episodeId).toBe("ep_a");
    expect(ws?.productions[0]?.activeStoryboard).toBeNull();
  });
});
