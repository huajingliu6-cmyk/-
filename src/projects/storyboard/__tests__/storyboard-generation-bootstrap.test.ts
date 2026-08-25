import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeProduction } from "@/projects/storyboard/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function baseProduction(overrides: Partial<EpisodeProduction> = {}): EpisodeProduction {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "prod_ep1",
    projectId: "proj_1",
    episodeId: "ep1",
    episodeNumber: 1,
    currentStep: 2,
    status: "awaiting_storyboard",
    workingScriptText: "第一集剧本",
    workingScriptRevision: 1,
    confirmedScriptText: "第一集剧本",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "hash",
    scriptConfirmedAt: now,
    scriptConfirmedBy: "user_1",
    assetMatches: [],
    confirmedAssetSnapshotHash: null,
    assetsConfirmedAt: null,
    assetsConfirmedBy: null,
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: null,
    generationError: null,
    storyboardGenerationJob: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

vi.mock("@/projects/storyboard/services/ensure-storyboard-workspace", () => ({
  ensureStoryboardWorkspaceReady: vi.fn(),
}));

vi.mock("@/projects/storyboard/api-helpers", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/projects/storyboard/api-helpers")
  >();
  return {
    ...actual,
    persistProduction: vi.fn(async (_workspace, production) => production),
    replaceProduction: vi.fn((workspace, production) => ({
      ...workspace,
      productions: workspace.productions.map((item) =>
        item.episodeId === production.episodeId ? production : item,
      ),
    })),
  };
});

vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: vi.fn(async () => ({
    characters: [{ id: "c1", name: "角色" }],
    scenes: [],
    props: [],
    audios: [],
  })),
}));

vi.mock("@/projects/project-access", () => ({
  getProjectRecord: vi.fn(async () => ({
    projectId: "proj_1",
    visualStyle: "realistic",
    highlights: [],
  })),
}));

vi.mock("@/projects/project-visual-style", () => ({
  requireProjectVisualStyleDirective: vi.fn(() => ({
    ok: true,
    styleId: "realistic",
    directive: "写实",
  })),
}));

vi.mock("@/projects/script/script-draft-store", () => ({
  loadScriptDraft: vi.fn(async () => ({
    episodes: [{ id: "ep1", episodeNumber: 1, title: "第一集", content: "剧本" }],
  })),
}));

vi.mock("@/projects/storyboard/services/storyboard-generating-lock", () => ({
  isStoryboardGeneratingLockActive: vi.fn(() => false),
}));

vi.mock("@/projects/storyboard/services/storyboard-generate", () => ({
  generateStructuredStoryboard: vi.fn(() => ({
    id: "sb1",
    version: 1,
    revision: 1,
    status: "ready",
    scenes: [{ id: "sc1", shots: [{ id: "sh1", shotNumber: 1 }] }],
    generationJobId: "job1",
  })),
  mergePreserveLockedShots: vi.fn((_prev, next) => next),
}));

vi.mock("@/projects/storyboard/services/ensure-storyboard-character-bindings", () => ({
  ensureStoryboardCharacterBindings: vi.fn(({ storyboard }) => ({
    ok: true,
    storyboard,
    diagnostics: [],
    libraryCharacterCount: 1,
  })),
}));

vi.mock("@/projects/storyboard/services/storyboard-prompt-context", () => ({
  buildStoryboardPromptContext: vi.fn(() => ({})),
}));

vi.mock("@/projects/storyboard/services/storyboard-prompt-llm", () => ({
  fillShotVideoPromptsWithLlm: vi.fn(async ({ storyboard }) => ({
    storyboard,
    generatedCount: 1,
    unmatchedCount: 0,
  })),
  StoryboardPromptFillError: class StoryboardPromptFillError extends Error {},
}));

import { ensureStoryboardWorkspaceReady } from "@/projects/storyboard/services/ensure-storyboard-workspace";
import { persistProduction } from "@/projects/storyboard/api-helpers";
import { generateStoryboardEpisode } from "@/projects/storyboard/services/generate-storyboard-episode";
import { persistStoryboardGenerationFailure } from "@/projects/storyboard/services/persist-storyboard-generation-failure";

describe("storyboard generation bootstrap contracts", () => {
  it("bootstraps workspace before generation instead of throwing missing workspace", () => {
    const generate = readSrc(
      "src/projects/storyboard/services/generate-storyboard-episode.ts",
    );
    const ensure = readSrc(
      "src/projects/storyboard/services/ensure-storyboard-workspace.ts",
    );
    expect(generate).toContain("ensureStoryboardWorkspaceReady");
    expect(generate).toContain("ensureStoryboardCharacterBindings");
    expect(generate).not.toContain('throw new Error("分镜工作台不存在")');
    expect(ensure).toContain("ensureEpisodeProductions");
    expect(ensure).toContain("updateWorkspaceUnderLock");
  });

  it("persists generation_failed through downstream failure helper", () => {
    const persist = readSrc(
      "src/projects/storyboard/services/persist-storyboard-generation-failure.ts",
    );
    const downstream = readSrc(
      "src/projects/storyboard/services/episode-extraction-downstream.ts",
    );
    expect(persist).toContain('status: "generation_failed"');
    expect(downstream).not.toContain("project-downstream-episode-error");
  });
});

describe("generateStoryboardEpisode bootstrap behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates workspace via ensureStoryboardWorkspaceReady for legacy projects", async () => {
    const production = baseProduction();
    vi.mocked(ensureStoryboardWorkspaceReady).mockResolvedValue({
      workspace: {
        projectId: "proj_1",
        activeEpisodeId: "ep1",
        productions: [production],
        videoDefaults: null,
        revision: 1,
        createdAt: production.createdAt,
        updatedAt: production.updatedAt,
      },
      production,
    });

    const result = await generateStoryboardEpisode({
      projectId: "proj_1",
      episodeId: "ep1",
      userId: "user_1",
    });

    expect(ensureStoryboardWorkspaceReady).toHaveBeenCalledWith({
      projectId: "proj_1",
      episodeId: "ep1",
      userId: "user_1",
    });
    expect(result.ok).toBe(true);
  });

  it("persists generation_failed when bootstrap or pre-LLM setup fails", async () => {
    const production = baseProduction();
    vi.mocked(ensureStoryboardWorkspaceReady).mockResolvedValue({
      workspace: {
        projectId: "proj_1",
        activeEpisodeId: "ep1",
        productions: [production],
        videoDefaults: null,
        revision: 1,
        createdAt: production.createdAt,
        updatedAt: production.updatedAt,
      },
      production,
    });

    const failed = await persistStoryboardGenerationFailure({
      projectId: "proj_1",
      episodeId: "ep1",
      userId: "user_1",
      error: new Error("无法初始化分镜工作台"),
    });

    expect(failed.ok).toBe(false);
    expect(failed.production.status).toBe("generation_failed");
    expect(failed.error).toContain("无法初始化分镜工作台");
    expect(persistProduction).toHaveBeenCalled();
  });

  it("routes pre-LLM failures through persistStoryboardGenerationFailure", async () => {
    const production = baseProduction();
    vi.mocked(ensureStoryboardWorkspaceReady)
      .mockRejectedValueOnce(new Error("分镜工作台不存在"))
      .mockResolvedValueOnce({
        workspace: {
          projectId: "proj_1",
          activeEpisodeId: "ep1",
          productions: [production],
          videoDefaults: null,
          revision: 1,
          createdAt: production.createdAt,
          updatedAt: production.updatedAt,
        },
        production,
      });

    const failed = await generateStoryboardEpisode({
      projectId: "proj_1",
      episodeId: "ep1",
      userId: "user_1",
    });

    expect(failed.ok).toBe(false);
    expect(failed.production.status).toBe("generation_failed");
    expect(failed.error).toContain("分镜工作台不存在");
  });

  it("returns existing production for duplicate idempotency key", async () => {
    const production = baseProduction({
      status: "storyboard_incomplete",
      activeStoryboard: {
        id: "sb1",
        version: 1,
        revision: 1,
        status: "ready",
        scenes: [],
        generationJobId: "idem-1",
      } as EpisodeProduction["activeStoryboard"],
    });
    vi.mocked(ensureStoryboardWorkspaceReady).mockResolvedValue({
      workspace: {
        projectId: "proj_1",
        activeEpisodeId: "ep1",
        productions: [production],
        videoDefaults: null,
        revision: 1,
        createdAt: production.createdAt,
        updatedAt: production.updatedAt,
      },
      production,
    });
    const { generateStructuredStoryboard } = await import(
      "@/projects/storyboard/services/storyboard-generate"
    );

    const result = await generateStoryboardEpisode({
      projectId: "proj_1",
      episodeId: "ep1",
      userId: "user_1",
      idempotencyKey: "idem-1",
    });

    expect(result.ok).toBe(true);
    expect(result.production).toBe(production);
    expect(generateStructuredStoryboard).not.toHaveBeenCalled();
  });
});
