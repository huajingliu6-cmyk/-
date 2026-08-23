import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { startAssetExtractionTask } from "@/projects/assets/extraction/start-task";
import {
  getLiveTask,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import { allAssetsTaskKey } from "@/projects/assets/extraction/task-key";

vi.mock("@/projects/assets/extraction/run-task", () => ({
  dispatchAssetExtractionRunner: vi.fn(),
  runAssetExtractionTask: vi.fn(),
}));

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("extract busy persistence contracts (UI)", () => {
  const workspace = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );

  it("routes episode extract through the versioned extraction API", () => {
    expect(workspace).toContain("asset-extraction/tasks");
    expect(workspace).toContain('scope: "episode"');
    expect(workspace).not.toContain("handleExtractAll");
    expect(workspace).not.toContain('outputKind: "script_asset_design"');
    expect(workspace).not.toContain("SCRIPT_ASSET_DESIGN_ID");
  });
});

describe("versioned extraction task reuse", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-extract-busy-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reuses one live task for the same fingerprint across tabs", async () => {
    const projectId = "proj_busy";
    const first = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: "fp1",
      scope: "all",
      modelKey: "deepseek-v4-pro",
    });
    const second = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: "fp1",
      scope: "all",
      modelKey: "deepseek-v4-pro",
    });
    expect(second.reused).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    const store = await loadAssetExtractionStore(projectId);
    const live = getLiveTask(store, allAssetsTaskKey(projectId, "fp1"));
    expect(live?.id).toBe(first.task.id);
    expect(
      store.tasks.filter(
        (task) =>
          task.status !== "completed" &&
          task.status !== "failed",
      ),
    ).toHaveLength(1);
  });
});

describe("workspace + management surface parity (source)", () => {
  it("workspace detail no longer serves the fake full-script episode", () => {
    const workspaceApi = readSrc(
      "src/projects/workspace-sync/workspace-episode-design-api.ts",
    );
    const mgmtApi = readSrc(
      "src/projects/assets/episode-design/episode-design-api.ts",
    );
    expect(mgmtApi).toContain('episodeId === "__full_script__"');
    expect(workspaceApi).toContain('episodeId === "__full_script__"');
    expect(mgmtApi).toContain("全剧本提取已迁移到资产提取任务");
  });
});
