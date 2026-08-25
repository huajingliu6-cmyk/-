import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { detectExtractionConflicts } from "@/projects/assets/extraction/conflicts";
import { mergeExtractedAssets } from "@/projects/assets/extraction/merge";
import {
  allAssetsTaskKey,
  episodeAssetsTaskKey,
} from "@/projects/assets/extraction/task-key";
import { assetIdentity, originalAiFingerprint } from "@/projects/assets/extraction/identity";
import { startAssetExtractionTask } from "@/projects/assets/extraction/start-task";
import {
  getActiveVersion,
  getLiveTask,
  loadAssetExtractionStore,
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import { applyCandidateVersion } from "@/projects/assets/extraction/apply-candidate";
import { afterScriptSplitConfirmed } from "@/projects/assets/extraction/after-confirm";
import {
  isHrefInsideProject,
  shouldBlockGenerationLeave,
  beginGenerationBusy,
  clearGenerationBusyForTests,
  confirmGenerationLeaveIfNeeded,
} from "@/shell/generation-busy";
import type { ExtractedAsset } from "@/projects/assets/extraction/types";
import { ASSET_EXTRACTION_NAV_BLOCK_MESSAGE } from "@/projects/assets/extraction/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function characterAsset(
  name: string,
  description: string,
  episodeIds: string[] = [],
): ExtractedAsset {
  const draft = {
    description,
    appearance: "",
    clothing: "",
    role: "主角",
    age: "",
    voiceId: null,
    voiceName: null,
    voiceBound: false,
    usageInEpisode: "",
    evidence: "",
  };
  return {
    identity: assetIdentity("character", name),
    assetType: "character",
    name,
    draft,
    originalAiFingerprint: originalAiFingerprint(draft),
    sourceEpisodeIds: episodeIds,
  };
}

vi.mock("@/projects/assets/extraction/run-task", () => ({
  dispatchAssetExtractionRunner: vi.fn(),
  runAssetExtractionTask: vi.fn(),
}));

describe("asset extraction replacement contracts", () => {
  it("assets page no longer exposes old full-script extract UI", () => {
    const workspace = readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx");
    const toolbar = readSrc("src/projects/assets/AssetExtractionToolbar.tsx");
    const amw = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    expect(workspace).not.toContain("handleExtractAll");
    expect(workspace).not.toContain("SCRIPT_ASSET_DESIGN_ID");
    expect(workspace).not.toContain("__full_script__");
    expect(workspace).not.toContain("一键提取基本资产");
    expect(workspace).not.toContain("ead-extract-all");
    expect(workspace).not.toContain("ead-cancel-extract-all");
    expect(workspace).not.toContain("通常需要 2-10 分钟");
    expect(workspace).not.toContain("extractJobsRef");
    expect(workspace).not.toContain("handleCancelGenerate");
    expect(workspace).not.toContain('outputKind: "script_asset_design"');
    expect(toolbar).toContain("提取本集资产");
    expect(toolbar).toContain("showExtractButton");
    expect(toolbar).toContain('data-testid="ead-extract-episode"');
    expect(toolbar).toContain('data-testid="ead-episode-select"');
    expect(toolbar).not.toContain("全剧本提取");
    expect(toolbar).not.toContain("一键提取资产");
    expect(amw).not.toContain("buildMockAssetBundle");
    expect(amw).toContain("ASSET_EXTRACTION_MISSING_HINT");
    expect(amw).toContain("showEpisodeExtractButton");
    expect(amw).toContain("viewEpisodeId !== null");
  });

  it("confirm script does not auto-start extraction (manual stage flow)", () => {
    const script = readSrc("src/projects/script/ScriptCreationWorkspace.tsx");
    const amw = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    const afterConfirm = readSrc("src/projects/assets/extraction/after-confirm.ts");
    const confirmSplit = readSrc(
      "src/app/api/projects/[projectId]/script-draft/confirm-split/route.ts",
    );
    const guard = readSrc("src/projects/script/ScriptDownstreamPipelineGuard.tsx");
    const runTask = readSrc("src/projects/assets/extraction/run-task.ts");
    expect(script).toContain("confirm-split");
    expect(afterConfirm).not.toContain("startAssetExtractionTask");
    expect(afterConfirm).toContain('action: "noop"');
    expect(runTask).toContain("runEpisodeExtractionDownstream");
    expect(amw).toContain("useScriptDownstreamPipeline");
    expect(guard).toContain("asset-extraction");
  });

  it("navigation intercepts the current project only", () => {
    const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
    const nav = readSrc("src/shell/AuthenticatedNavigation.tsx");
    const stage = readSrc("src/projects/workbench/ProjectStageNav.tsx");
    expect(guard).toContain("asset-extraction-overlay");
    expect(guard).toContain("ASSET_EXTRACTION_NAV_BLOCK_MESSAGE");
    expect(readSrc("src/projects/assets/extraction/types.ts")).toContain(
      "资产提取尚未完成，请耐心等待。",
    );
    expect(nav).toContain("confirmGenerationLeaveIfNeeded(item.href)");
    expect(readSrc("src/projects/workbench/ProjectStageNavLinks.tsx")).toContain(
      "shouldBlockGenerationLeave(stage.href)",
    );
  });
});

describe("asset extraction domain", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-extract-arch-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    delete process.env.REMOTE_DATA_ONLY;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reuses one live task for the same fingerprint", async () => {
    const projectId = "p_extract_reuse";
    const fingerprint = "fp-same";
    const first = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: fingerprint,
      scope: "all",
    });
    const second = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: fingerprint,
      scope: "all",
    });
    expect(second.reused).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    const store = await loadAssetExtractionStore(projectId);
    const live = store.tasks.filter(
      (task) =>
        task.taskKey === allAssetsTaskKey(projectId, fingerprint) &&
        (task.status === "discovering_roster" ||
          task.status === "extracting_details" ||
          task.status === "retrying_failed_once"),
    );
    expect(live).toHaveLength(1);
  });

  it("keeps old assets when a candidate fails", async () => {
    const projectId = "p_extract_fail";
    const activeAsset = characterAsset("林清", "旧描述");
    await mutateAssetExtractionStore(projectId, (store) => ({
      ...store,
      migratedFromLegacy: true,
      versions: [
        {
          id: "ver_active",
          projectId,
          sourceFingerprint: "fp-old",
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: "ver_cand",
          projectId,
          sourceFingerprint: "fp-new",
          status: "candidate",
          modelKey: "deepseek-v4-pro",
          attempt: 2,
          createdAt: new Date().toISOString(),
        },
      ],
      results: [
        {
          versionId: "ver_active",
          scope: "all",
          episodeId: null,
          assets: [activeAsset],
        },
      ],
      tasks: [
        {
          id: "task_fail",
          projectId,
          taskKey: allAssetsTaskKey(projectId, "fp-new"),
          sourceFingerprint: "fp-new",
          scope: "all",
          episodeId: null,
          modelKey: "deepseek-v4-pro",
          status: "failed",
          stage: "discovering_roster",
          estimatedProgress: 15,
          revision: 2,
          errorMessage: "模型失败",
          versionId: "ver_cand",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }));
    const store = await loadAssetExtractionStore(projectId);
    expect(getActiveVersion(store)?.id).toBe("ver_active");
    expect(store.results[0]?.assets[0]?.name).toBe("林清");
    expect(getLiveTask(store)).toBeNull();
  });

  it("replaces full-script and episode supplements together when applying a candidate", async () => {
    const projectId = "p_extract_apply";
    const oldAll = characterAsset("林清", "全剧旧");
    const oldEpisode = characterAsset("阿砚", "单集旧", ["ep_1"]);
    const nextAll = characterAsset("林清", "全剧新");
    const nextNew = characterAsset("顾衡", "新增");
    await mutateAssetExtractionStore(projectId, (store) => ({
      ...store,
      migratedFromLegacy: true,
      versions: [
        {
          id: "ver_active",
          projectId,
          sourceFingerprint: "fp-old",
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: "ver_cand",
          projectId,
          sourceFingerprint: "fp-new",
          status: "candidate",
          modelKey: "deepseek-v4-pro",
          attempt: 2,
          createdAt: new Date().toISOString(),
        },
      ],
      results: [
        {
          versionId: "ver_active",
          scope: "all",
          episodeId: null,
          assets: [oldAll],
        },
        {
          versionId: "ver_active",
          scope: "episode",
          episodeId: "ep_1",
          assets: [oldEpisode],
        },
        {
          versionId: "ver_cand",
          scope: "all",
          episodeId: null,
          assets: [nextAll, nextNew],
        },
      ],
    }));
    const applied = await applyCandidateVersion({ projectId });
    expect(applied.ok).toBe(true);
    const store = await loadAssetExtractionStore(projectId);
    expect(getActiveVersion(store)?.id).toBe("ver_cand");
    expect(store.versions.find((version) => version.id === "ver_active")?.status).toBe(
      "archived",
    );
    const names = store.results
      .filter((result) => result.versionId === "ver_cand")
      .flatMap((result) => result.assets.map((asset) => asset.name))
      .sort();
    expect(names.sort()).toEqual(["林清", "顾衡"].sort());
    expect(names).not.toContain("阿砚");
  });

  it("lets each conflicting manual edit be decided independently", () => {
    const activeA = characterAsset("林清", "人工");
    const activeB = characterAsset("顾衡", "人工B");
    const candidateA = characterAsset("林清", "新AI");
    const conflicts = detectExtractionConflicts({
      activeAssets: [activeA, activeB],
      candidateAssets: [candidateA],
      overrides: [
        {
          projectId: "p",
          versionId: "active",
          assetIdentity: activeA.identity,
          fields: { draft: activeA.draft },
          originalAiFingerprint: activeA.originalAiFingerprint,
          updatedAt: new Date().toISOString(),
        },
        {
          projectId: "p",
          versionId: "active",
          assetIdentity: activeB.identity,
          fields: { draft: activeB.draft },
          originalAiFingerprint: activeB.originalAiFingerprint,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    expect(conflicts.map((item) => item.identity).sort()).toEqual(
      [activeA.identity, activeB.identity].sort(),
    );
    expect(conflicts.find((item) => item.identity === activeA.identity)?.kind).toBe(
      "changed",
    );
    expect(conflicts.find((item) => item.identity === activeB.identity)?.kind).toBe(
      "removed",
    );
  });

  it("merges episode results into totals without duplicates", () => {
    const fromAll = characterAsset("林清", "全剧", []);
    const fromEpisode = characterAsset("林清", "本集补充", ["ep_1"]);
    const extra = characterAsset("阿砚", "本集", ["ep_1"]);
    const merged = mergeExtractedAssets([[fromAll], [fromEpisode, extra]]);
    expect(merged).toHaveLength(2);
    const lin = merged.find((asset) => asset.name === "林清");
    expect(lin?.sourceEpisodeIds).toEqual(["ep_1"]);
  });

  it("hides terminal_failed assets from the public task and candidate results", async () => {
    const { toPublicExtractionTask } = await import(
      "@/projects/assets/extraction/public-task"
    );
    const projectId = "p_terminal_failed";
    const fingerprint = "fp-tf";
    const now = new Date().toISOString();
    const kept = characterAsset("甲", "成功");
    await mutateAssetExtractionStore(projectId, (store) => ({
      ...store,
      migratedFromLegacy: true,
      versions: [
        {
          id: "ver_active",
          projectId,
          sourceFingerprint: fingerprint,
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: now,
        },
      ],
      results: [
        {
          versionId: "ver_active",
          scope: "all",
          episodeId: null,
          assets: [kept],
        },
      ],
      tasks: [
        {
          id: "task_done",
          projectId,
          taskKey: allAssetsTaskKey(projectId, fingerprint),
          sourceFingerprint: fingerprint,
          scope: "all",
          episodeId: null,
          modelKey: "deepseek-v4-pro",
          status: "completed",
          stage: "complete",
          estimatedProgress: 100,
          revision: 4,
          errorMessage: null,
          versionId: "ver_active",
          createdAt: now,
          updatedAt: now,
          detailItems: [
            {
              assetKey: kept.identity,
              name: "甲",
              status: "completed",
              attempt: 1,
            },
            {
              assetKey: "character:wu",
              name: "戊",
              status: "terminal_failed",
              attempt: 2,
              batchIndex: 1,
              errorCode: "ASSET_DETAIL_MISSING",
              errorMessage: "模型未返回该资产",
            },
          ],
          failedAssetQueue: ["character:wu"],
        },
      ],
    }));
    const store = await loadAssetExtractionStore(projectId);
    const task = store.tasks[0]!;
    const publicTask = toPublicExtractionTask(task);
    expect(publicTask.status).toBe("completed");
    expect(publicTask.errorMessage).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(publicTask, "detailItems"),
    ).toBe(false);
    expect(store.results[0]?.assets.map((asset) => asset.name)).toEqual(["甲"]);
    expect(store.results[0]?.assets.some((asset) => asset.name === "戊")).toBe(
      false,
    );
  });
});

describe("confirm-split extraction actions", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-extract-confirm-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does not auto-start extraction when there is no active version", async () => {
    const action = await afterScriptSplitConfirmed({
      projectId: "p_prompt",
      sourceFingerprint: "fp1",
    });
    expect(action.action).toBe("noop");
    const store = await loadAssetExtractionStore("p_prompt");
    expect(getLiveTask(store)).toBeNull();
  });

  it("is a noop when fingerprint is unchanged", async () => {
    await mutateAssetExtractionStore("p_noop", (store) => ({
      ...store,
      migratedFromLegacy: true,
      versions: [
        {
          id: "ver_active",
          projectId: "p_noop",
          sourceFingerprint: "fp1",
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    const action = await afterScriptSplitConfirmed({
      projectId: "p_noop",
      sourceFingerprint: "fp1",
    });
    expect(action.action).toBe("noop");
  });

  it("auto-creates a candidate when fingerprint changes", async () => {
    await mutateAssetExtractionStore("p_auto", (store) => ({
      ...store,
      migratedFromLegacy: true,
      versions: [
        {
          id: "ver_active",
          projectId: "p_auto",
          sourceFingerprint: "fp-old",
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    const action = await afterScriptSplitConfirmed({
      projectId: "p_auto",
      sourceFingerprint: "fp-new",
    });
    expect(action.action).toBe("noop");
    const store = await loadAssetExtractionStore("p_auto");
    expect(getLiveTask(store)).toBeNull();
  });
});

describe("generation busy project scope", () => {
  beforeEach(() => {
    clearGenerationBusyForTests();
  });

  it("blocks the current project and allows home and other projects", async () => {
    beginGenerationBusy("extract-p1", "资产提取", {
      projectId: "p1",
      kind: "asset-extraction",
      leaveMessage: ASSET_EXTRACTION_NAV_BLOCK_MESSAGE,
    });
    expect(isHrefInsideProject("/app/projects/p1/assets", "p1")).toBe(true);
    expect(isHrefInsideProject("/app/projects", "p1")).toBe(false);
    expect(isHrefInsideProject("/app", "p1")).toBe(false);
    expect(isHrefInsideProject("/app/projects/p2/assets", "p1")).toBe(false);
    expect(shouldBlockGenerationLeave("/app/projects/p1/storyboard")).toBe(false);
    expect(shouldBlockGenerationLeave("/app/projects")).toBe(false);
    expect(shouldBlockGenerationLeave("/app/projects/p2/script")).toBe(false);
    expect(await confirmGenerationLeaveIfNeeded("/")).toBe(true);
    expect(await confirmGenerationLeaveIfNeeded("/app/projects/p1/assets")).toBe(
      false,
    );
  });
});

describe("runtime search no longer uses the fake episode id in extract APIs", () => {
  it("rejects the legacy full-script episode in design detail", () => {
    const api = readSrc(
      "src/projects/assets/episode-design/episode-design-api.ts",
    );
    const workspaceApi = readSrc(
      "src/projects/workspace-sync/workspace-episode-design-api.ts",
    );
    expect(api).toContain('episodeId === "__full_script__"');
    expect(api).toContain("全剧本提取已迁移到资产提取任务");
    expect(workspaceApi).toContain("全剧本提取已迁移到资产提取任务");
    expect(api).not.toContain("完整原始剧本");
  });

  it("runtime extract UI and start-task no longer call handleExtractAll", () => {
    const workspace = readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx");
    const amw = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    const start = readSrc("src/projects/assets/extraction/start-task.ts");
    const run = readSrc("src/projects/assets/extraction/run-task.ts");
    expect(workspace).not.toContain("handleExtractAll");
    expect(amw).not.toContain("handleExtractAll");
    expect(start).not.toContain("SCRIPT_ASSET_DESIGN_ID");
    expect(run).not.toContain("__full_script__");
    expect(run).not.toContain("handleExtractAll");
    expect(run).not.toContain("runScriptAssetMapReduce");
  });
});
