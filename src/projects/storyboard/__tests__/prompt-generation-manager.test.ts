import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetPromptGenerationManagerForTests,
  getPromptGenerationSnapshot,
  releaseQueuedPromptGenerationOnPageLeave,
  requestEpisodePromptGeneration,
  syncPromptGenerationFromProduction,
  STORYBOARD_PROMPT_GEN_MAX_CONCURRENT,
} from "@/projects/storyboard/prompt-generation-manager";

describe("prompt-generation-manager", () => {
  afterEach(() => {
    __resetPromptGenerationManagerForTests();
  });

  it("caps concurrent generations and queues the rest", async () => {
    const projectId = "proj-a";
    const releases: Array<() => void> = [];
    const started: string[] = [];

    const makeRun = (episodeId: string) => () =>
      new Promise<void>((resolve) => {
        started.push(episodeId);
        releases.push(resolve);
      });

    for (let i = 0; i < STORYBOARD_PROMPT_GEN_MAX_CONCURRENT; i += 1) {
      const id = `ep-${i}`;
      const result = requestEpisodePromptGeneration({
        projectId,
        episodeId: id,
        run: makeRun(id),
      });
      expect(result.queued).toBe(false);
      expect(result.accepted).toBe(true);
    }

    const overflow = requestEpisodePromptGeneration({
      projectId,
      episodeId: "ep-overflow",
      run: makeRun("ep-overflow"),
    });
    expect(overflow.queued).toBe(true);
    expect(overflow.generatingCount).toBe(STORYBOARD_PROMPT_GEN_MAX_CONCURRENT);
    expect(overflow.queuedCount).toBe(1);
    expect(overflow.message).toMatch(/最多同时生成 10 集/);

    const snap = getPromptGenerationSnapshot(projectId);
    expect(snap.jobs["ep-overflow"]?.status).toBe("queued");
    expect(started).toHaveLength(STORYBOARD_PROMPT_GEN_MAX_CONCURRENT);

    // Finish one → queue starts
    releases.shift()?.();
    await vi.waitFor(() => {
      expect(started).toContain("ep-overflow");
    });
  });

  it("rejects duplicate concurrent request for the same episode", () => {
    const projectId = "proj-b";
    let resolveRun: (() => void) | undefined;
    const first = requestEpisodePromptGeneration({
      projectId,
      episodeId: "ep-1",
      run: () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    });
    expect(first.accepted).toBe(true);

    const second = requestEpisodePromptGeneration({
      projectId,
      episodeId: "ep-1",
      run: async () => undefined,
    });
    expect(second.accepted).toBe(false);
    resolveRun?.();
  });

  it("isolates failures per episode", async () => {
    const projectId = "proj-c";
    requestEpisodePromptGeneration({
      projectId,
      episodeId: "ok",
      run: async () => undefined,
    });
    requestEpisodePromptGeneration({
      projectId,
      episodeId: "bad",
      run: async () => {
        throw new Error("boom");
      },
    });

    await vi.waitFor(() => {
      const snap = getPromptGenerationSnapshot(projectId);
      expect(snap.jobs.ok?.status).toBe("success");
      expect(snap.jobs.bad?.status).toBe("failed");
      expect(snap.jobs.bad?.error).toBe("boom");
    });
  });

  it("caches getSnapshot identity until state changes", () => {
    const projectId = "proj-cache";
    const a = getPromptGenerationSnapshot(projectId);
    const b = getPromptGenerationSnapshot(projectId);
    expect(a).toBe(b);

    requestEpisodePromptGeneration({
      projectId,
      episodeId: "ep-1",
      run: async () => undefined,
    });
    const c = getPromptGenerationSnapshot(projectId);
    expect(c).not.toBe(a);
    expect(getPromptGenerationSnapshot(projectId)).toBe(c);
  });

  it("releases queued jobs when leaving the storyboard page", () => {
    const projectId = "proj-leave";
    for (let i = 0; i < STORYBOARD_PROMPT_GEN_MAX_CONCURRENT; i += 1) {
      requestEpisodePromptGeneration({
        projectId,
        episodeId: `ep-${i}`,
        run: () => new Promise<void>(() => undefined),
      });
    }
    requestEpisodePromptGeneration({
      projectId,
      episodeId: "ep-queued",
      run: async () => undefined,
    });
    expect(getPromptGenerationSnapshot(projectId).queuedCount).toBe(1);

    releaseQueuedPromptGenerationOnPageLeave(projectId);
    const snap = getPromptGenerationSnapshot(projectId);
    expect(snap.queuedCount).toBe(0);
    expect(snap.jobs["ep-queued"]).toBeUndefined();
  });

  it("ignores stale server storyboard_generating locks", () => {
    const projectId = "proj-stale";
    const staleUpdatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    syncPromptGenerationFromProduction({
      projectId,
      episodeId: "ep-stale",
      productionStatus: "storyboard_generating",
      updatedAt: staleUpdatedAt,
    });
    expect(getPromptGenerationSnapshot(projectId).jobs["ep-stale"]).toBeUndefined();
  });
});
