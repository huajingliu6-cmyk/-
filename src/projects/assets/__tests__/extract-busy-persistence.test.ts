import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { readFileSync } from "fs";
import {
  getOrCreateEpisodeRecord,
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import { SCRIPT_ASSET_DESIGN_ID } from "@/projects/assets/episode-design/types";
import {
  isExtractInProgress,
  reconcileGeneratingExtractRecord,
} from "@/projects/assets/episode-design/reconcile-extract-status";
import { findBlockingAssetExtract } from "@/projects/assets/episode-design/assert-extract-not-busy";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("extract busy persistence contracts (UI)", () => {
  const workspace = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );

  it("uses unified extractionBusy for buttons and busy guard", () => {
    expect(workspace).toContain("const extractionBusy =");
    expect(workspace).toContain('designStatus === "generating"');
    expect(workspace).toContain('extractionBusy ? "提取中…"');
    expect(workspace).toContain("disabled={extractionBusy || saving || confirming}");
    expect(workspace).toContain("markExtractStatusForEpisode");
    expect(workspace).toContain('outputKind: "script_asset_design"');
    expect(workspace).toContain("activeGeneration");
    expect(workspace).not.toContain("210_000");
    expect(workspace).toMatch(/setInterval\(\(\) => \{\s*void tick\(\);\s*\}, 2000\)/);
  });

  it("does not auto-fail generating solely because remount cleared local refs", () => {
    expect(workspace).not.toContain("generatingRef");
    expect(workspace).toContain("Keep polling — server reconcile decides failed/stale");
    expect(workspace).not.toContain("上次提取已中断，请重新提取。");
  });

  it("handleExtractAll persists SCRIPT_ASSET_DESIGN_ID as generating before stream", () => {
    expect(workspace).toMatch(
      /markExtractStatusForEpisode\(\{[\s\S]*?episodeId: extractingEpisodeId,[\s\S]*?status: "generating"/,
    );
    expect(workspace).toContain('outputKind: "script_asset_design"');
    expect(workspace).toContain('outputKind: "episode_asset_design"');
  });

  it("busy conflict keeps polling instead of marking failed", () => {
    expect(workspace).toContain('error.code === "ASSET_EXTRACT_IN_PROGRESS"');
    expect(workspace).toContain("startExtractPoll(extractingEpisodeId)");
  });
});

describe("reconcile + block concurrent extract", () => {
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

  function baseJob(
    overrides: Partial<TextGenerationJob> = {},
  ): TextGenerationJob {
    return {
      generationId: "tg_extract_busy_1",
      projectId: "proj_busy",
      userId: "user_busy",
      outputKind: "script_asset_design",
      modelKey: "balanced-default",
      displayModelName: "mock",
      providerModelId: "mock",
      brief: "x",
      targetChars: 2000,
      status: "running",
      content: "",
      actualChars: 0,
      inputTokens: null,
      outputTokens: null,
      reservedPoints: 1,
      chargedPoints: 0,
      idempotencyKey: "idem_busy",
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("persists generating with activeGeneration and blocks duplicate submit", async () => {
    const projectId = "proj_busy";
    let store = await loadEpisodeAssetDesignStore(projectId);
    const { record } = getOrCreateEpisodeRecord(
      store,
      SCRIPT_ASSET_DESIGN_ID,
      0,
    );
    const startedAt = new Date().toISOString();
    const next = {
      ...record,
      status: "generating" as const,
      revision: record.revision + 1,
      activeGeneration: {
        generationId: "tg_extract_busy_1",
        idempotencyKey: "idem_busy",
        outputKind: "script_asset_design" as const,
        startedAt,
        updatedAt: startedAt,
      },
      updatedAt: startedAt,
    };
    store = upsertEpisodeRecord(store, next);
    await saveEpisodeAssetDesignStore(store);
    await saveTextJob(baseJob({ projectId, status: "running" }));

    const blocked = await findBlockingAssetExtract({
      projectId,
      episodeId: SCRIPT_ASSET_DESIGN_ID,
      idempotencyKey: "other_tab",
    });
    expect(blocked.blocked).toBe(true);

    const same = await findBlockingAssetExtract({
      projectId,
      episodeId: SCRIPT_ASSET_DESIGN_ID,
      idempotencyKey: "idem_busy",
    });
    expect(same.blocked).toBe(false);
  });

  it("keeps legacy generating busy until timeout window", () => {
    const startedAt = new Date().toISOString();
    const record = {
      episodeId: SCRIPT_ASSET_DESIGN_ID,
      episodeNumber: 0,
      status: "generating" as const,
      revision: 1,
      contentFingerprint: null,
      generationId: null,
      items: [],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: startedAt,
    };
    expect(isExtractInProgress(record)).toBe(true);
    expect(isExtractInProgress(record, Date.now() + 700_000)).toBe(false);
  });

  it("reconcile applies completed job content into review", async () => {
    const projectId = "proj_busy_apply";
    let store = await loadEpisodeAssetDesignStore(projectId);
    const { record } = getOrCreateEpisodeRecord(
      store,
      SCRIPT_ASSET_DESIGN_ID,
      0,
    );
    const startedAt = new Date().toISOString();
    const generating = {
      ...record,
      status: "generating" as const,
      revision: 1,
      activeGeneration: {
        generationId: "tg_apply_1",
        idempotencyKey: "idem_apply",
        outputKind: "script_asset_design" as const,
        startedAt,
        updatedAt: startedAt,
      },
      updatedAt: startedAt,
    };
    store = upsertEpisodeRecord(store, generating);
    await saveEpisodeAssetDesignStore(store);

    await saveTextJob(
      baseJob({
        projectId,
        generationId: "tg_apply_1",
        status: "completed",
        content: JSON.stringify({
          version: 1,
          assets: [
            {
              type: "character",
              name: "林清",
              design: { role: "主角", usageInEpisode: "开场" },
            },
          ],
        }),
      }),
    );

    const reconciled = await reconcileGeneratingExtractRecord({
      projectId,
      record: generating,
      fingerprint: "fp1",
      episodeContent: "林清走进茶馆。",
      episodeNumber: 0,
      episodeTitle: "完整原始剧本",
      persist: async ({ record: next }) => {
        const s = await loadEpisodeAssetDesignStore(projectId);
        await saveEpisodeAssetDesignStore(upsertEpisodeRecord(s, next));
        return next;
      },
    });
    expect(reconciled.status).toBe("review");
    expect(reconciled.activeGeneration).toBeNull();
    expect(reconciled.items.length).toBeGreaterThan(0);
  });

  it("reconcile marks cancelled jobs as failed", async () => {
    const projectId = "proj_cancel";
    let store = await loadEpisodeAssetDesignStore(projectId);
    const { record } = getOrCreateEpisodeRecord(
      store,
      SCRIPT_ASSET_DESIGN_ID,
      0,
    );
    const startedAt = new Date().toISOString();
    const generating = {
      ...record,
      status: "generating" as const,
      revision: 1,
      activeGeneration: {
        generationId: "tg_cancel_1",
        idempotencyKey: "idem_cancel",
        outputKind: "script_asset_design" as const,
        startedAt,
        updatedAt: startedAt,
      },
      updatedAt: startedAt,
    };
    store = upsertEpisodeRecord(store, generating);
    await saveEpisodeAssetDesignStore(store);
    await saveTextJob(
      baseJob({
        projectId,
        generationId: "tg_cancel_1",
        status: "cancelled",
      }),
    );

    const reconciled = await reconcileGeneratingExtractRecord({
      projectId,
      record: generating,
      fingerprint: "fp",
      episodeContent: "正文",
      episodeNumber: 0,
      episodeTitle: "完整原始剧本",
      persist: async ({ record: next }) => next,
    });
    expect(reconciled.status).toBe("failed");
    expect(reconciled.activeGeneration).toBeNull();
  });

  it("episode extract also blocks concurrent submits", async () => {
    const projectId = "proj_ep_busy";
    const episodeId = "ep_busy_1";
    let store = await loadEpisodeAssetDesignStore(projectId);
    const { record } = getOrCreateEpisodeRecord(store, episodeId, 1);
    const startedAt = new Date().toISOString();
    store = upsertEpisodeRecord(store, {
      ...record,
      status: "generating",
      revision: 1,
      activeGeneration: {
        generationId: "tg_ep_1",
        idempotencyKey: "idem_ep",
        outputKind: "episode_asset_design",
        startedAt,
        updatedAt: startedAt,
      },
      updatedAt: startedAt,
    });
    await saveEpisodeAssetDesignStore(store);
    await saveTextJob(
      baseJob({
        projectId,
        generationId: "tg_ep_1",
        outputKind: "episode_asset_design",
        status: "queued",
        idempotencyKey: "idem_ep",
      }),
    );
    const blocked = await findBlockingAssetExtract({
      projectId,
      episodeId,
      idempotencyKey: "other",
    });
    expect(blocked.blocked).toBe(true);
  });
});

describe("workspace + management surface parity (source)", () => {
  it("workspace detail reconciles generating like management", () => {
    const workspaceApi = readSrc(
      "src/projects/workspace-sync/workspace-episode-design-api.ts",
    );
    const mgmtApi = readSrc(
      "src/projects/assets/episode-design/episode-design-api.ts",
    );
    expect(mgmtApi).toContain("reconcileGeneratingExtractRecord");
    expect(workspaceApi).toContain("reconcileGeneratingExtractRecord");
  });

  it("run-generation rejects concurrent asset extract with 409-style code", () => {
    const runGen = readSrc("src/text-generation/run-generation.ts");
    expect(runGen).toContain("ASSET_EXTRACT_IN_PROGRESS");
    expect(runGen).toContain("findBlockingAssetExtract");
  });
});
