import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalAssets,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";
import {
  applyWorkspaceEpisodeAssetDesignGeneration,
  getWorkspaceEpisodeAssetDesignDetail,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";

describe("workspace one-way sync isolation", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp = "";
  let projectId = "";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ws-sync-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";

    const project = await createProjectRecord("owner-1", {
      name: "Sync Test Project",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    projectId = project.projectId;

    await saveScriptDraft({
      projectId,
      sourceFile: null,
      sourceText: null,
      preambleNotes: null,
      sourceImport: null,
      novelTask: { status: "idle" },
      episodes: [
        {
          id: "ep-1",
          projectId,
          episodeNumber: 1,
          title: "第一集",
          content: "正式剧集正文 A",
          status: "saved",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "ep-1",
      listPage: 1,
      splitConfig: { targetChars: 3000 },
      novelOpen: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await saveAssetBundleDraft({
      projectId,
      characters: [
        {
          id: "char-mgmt",
          projectId,
          name: "管理端角色",
          role: "主角",
          description: "from management",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
  });

  function managementAssetsPath() {
    return path.join(tmp, "projects", projectId, "drafts", "assets.json");
  }

  function readManagementAssetsRaw() {
    return readFileSync(managementAssetsPath(), "utf-8");
  }

  function workspaceDesignsPath() {
    return path.join(
      tmp,
      "projects",
      projectId,
      "workspace",
      "episode-asset-designs.json",
    );
  }

  async function saveManagementDesignRecord(updatedAt: string) {
    const store = await loadEpisodeAssetDesignStore(projectId);
    await saveEpisodeAssetDesignStore(
      upsertEpisodeRecord(store, {
        episodeId: "ep-1",
        episodeNumber: 1,
        status: "review",
        revision: 1,
        contentFingerprint: "fp-upstream",
        generationId: null,
        items: [
          {
            id: `design-upstream-${updatedAt}`,
            assetType: "prop",
            name: "上游道具",
            resolution: "create_new",
            source: "ai",
            draft: {
              description: "from upstream",
              propType: "道具",
              usage: "剧情",
              usageInEpisode: "第一集",
              evidence: "正文",
            },
          },
        ],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt,
      }),
    );
  }

  async function saveWorkspaceLocalDesignRecord(updatedAt: string) {
    const store = await loadWorkspaceLocalEpisodeDesigns(projectId);
    await saveWorkspaceLocalEpisodeDesigns(
      upsertEpisodeRecord(store, {
        episodeId: "ep-1",
        episodeNumber: 1,
        status: "review",
        revision: 99,
        contentFingerprint: "fp-local",
        generationId: null,
        items: [
          {
            id: `design-local-${updatedAt}`,
            assetType: "prop",
            name: "本地道具",
            resolution: "create_new",
            source: "ai",
            draft: {
              description: "from local",
              propType: "道具",
              usage: "本地改动",
              usageInEpisode: "第一集",
              evidence: "本地",
            },
          },
        ],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt,
      }),
    );
  }

  it("after sync, workspace snapshot has episodes", async () => {
    const result = await syncManagementToWorkspace(projectId);
    expect(result.ok).toBe(true);

    const snapshot = await loadWorkspaceSnapshot(projectId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.episodes).toHaveLength(1);
    expect(snapshot!.episodes[0]?.title).toBe("第一集");
    expect(snapshot!.episodes[0]?.content).toBe("正式剧集正文 A");
    expect(snapshot!.upstreamRevision).toBeGreaterThan(0);
  });

  it("writing workspace local assets does NOT change management drafts/assets.json", async () => {
    await syncManagementToWorkspace(projectId);
    const before = readManagementAssetsRaw();

    await saveWorkspaceLocalAssets({
      projectId,
      characters: [
        {
          id: "char-ws",
          projectId,
          name: "工作区角色",
          role: "配角",
          description: "workspace only",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const after = readManagementAssetsRaw();
    expect(after).toBe(before);
    expect(after).toContain("char-mgmt");
    expect(after).not.toContain("char-ws");

    const local = await loadWorkspaceLocalAssets(projectId);
    expect(local?.characters[0]?.id).toBe("char-ws");
  });

  it("sync again preserves local overrides", async () => {
    await syncManagementToWorkspace(projectId);
    await saveWorkspaceLocalAssets({
      projectId,
      characters: [
        {
          id: "char-local",
          projectId,
          name: "本地保留",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const firstRevision = (await loadWorkspaceSnapshot(projectId))!
      .upstreamRevision;
    await syncManagementToWorkspace(projectId);

    const local = await loadWorkspaceLocalAssets(projectId);
    expect(local?.characters[0]?.id).toBe("char-local");

    const snapshot = await loadWorkspaceSnapshot(projectId);
    expect(snapshot!.upstreamRevision).toBeGreaterThan(firstRevision);
    expect(snapshot!.assets.characters[0]?.id).toBe("char-mgmt");
  });

  it("management path files unchanged after workspace PUT", async () => {
    await syncManagementToWorkspace(projectId);
    const before = readManagementAssetsRaw();

    await saveWorkspaceLocalAssets({
      projectId,
      characters: [
        {
          id: "char-route",
          projectId,
          name: "路由写入",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    expect(readManagementAssetsRaw()).toBe(before);

    // Verify workspace file was written
    const wsPath = path.join(
      tmp,
      "projects",
      projectId,
      "workspace",
      "assets.json",
    );
    const wsRaw = readFileSync(wsPath, "utf-8");
    expect(wsRaw).toContain("char-route");
    expect(wsRaw).not.toContain("char-mgmt");
  });

  it("reads upstream design when only upstream record exists", async () => {
    await saveManagementDesignRecord("2026-01-02T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);

    const detail = await getWorkspaceEpisodeAssetDesignDetail(projectId, "ep-1");
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.record.items[0]?.name).toBe("上游道具");
    expect(detail.record.contentFingerprint).toBe("fp-upstream");
  });

  it("keeps local design when local updatedAt is newer than upstream", async () => {
    await saveManagementDesignRecord("2026-01-02T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);
    await saveWorkspaceLocalDesignRecord("2026-01-03T00:00:00.000Z");

    const detail = await getWorkspaceEpisodeAssetDesignDetail(projectId, "ep-1");
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.record.items[0]?.name).toBe("本地道具");
    expect(detail.record.contentFingerprint).toBe("fp-local");
  });

  it("switches to upstream design when management re-extract is newer", async () => {
    await saveManagementDesignRecord("2026-01-02T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);
    await saveWorkspaceLocalDesignRecord("2026-01-03T00:00:00.000Z");

    await saveManagementDesignRecord("2026-01-04T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);

    const detail = await getWorkspaceEpisodeAssetDesignDetail(projectId, "ep-1");
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.record.items[0]?.name).toBe("上游道具");
    expect(detail.record.contentFingerprint).toBe("fp-upstream");
  });

  it("prefers local record when timestamps are invalid", async () => {
    await saveManagementDesignRecord("2026-01-02T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);
    await saveWorkspaceLocalDesignRecord("not-a-valid-time");

    const detail = await getWorkspaceEpisodeAssetDesignDetail(projectId, "ep-1");
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.record.items[0]?.name).toBe("本地道具");
    expect(detail.record.contentFingerprint).toBe("fp-local");
  });

  it("sync does not delete workspace local design file", async () => {
    await saveManagementDesignRecord("2026-01-02T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);
    await saveWorkspaceLocalDesignRecord("2026-01-03T00:00:00.000Z");

    const before = readFileSync(workspaceDesignsPath(), "utf-8");
    expect(before).toContain("design-local-2026-01-03T00:00:00.000Z");

    await saveManagementDesignRecord("2026-01-04T00:00:00.000Z");
    await syncManagementToWorkspace(projectId);

    const after = readFileSync(workspaceDesignsPath(), "utf-8");
    expect(after).toContain("design-local-2026-01-03T00:00:00.000Z");
  });

  it("allows workspace apply during generating when activeGeneration matches", async () => {
    const now = new Date().toISOString();
    await saveManagementDesignRecord(now);
    const store = await loadEpisodeAssetDesignStore(projectId);
    const fingerprint = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "第一集",
      content: "正式剧集正文 A",
    });
    await saveEpisodeAssetDesignStore(
      upsertEpisodeRecord(store, {
        episodeId: "ep-1",
        episodeNumber: 1,
        status: "generating",
        revision: 5,
        contentFingerprint: fingerprint,
        generationId: null,
        activeGeneration: {
          generationId: "gen-ws-active-1",
          idempotencyKey: "idem-ws-active-1",
          outputKind: "episode_asset_design",
          startedAt: now,
          updatedAt: now,
        },
        items: [],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt: now,
      }),
    );
    await syncManagementToWorkspace(projectId);

    const applied = await applyWorkspaceEpisodeAssetDesignGeneration({
      projectId,
      episodeId: "ep-1",
      generationId: "gen-ws-active-1",
      expectedRevision: 4,
      fingerprint,
      rawText: JSON.stringify({
        version: 1,
        assets: [
          {
            type: "prop",
            name: "上游道具",
            design: {
              description: "from upstream",
              propType: "道具",
              usage: "剧情",
              usageInEpisode: "第一集",
              evidence: "正文",
            },
          },
        ],
      }),
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.record.status).toBe("review");
    expect(applied.record.items).toHaveLength(1);

    const detail = await getWorkspaceEpisodeAssetDesignDetail(projectId, "ep-1");
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.record.status).toBe("review");
    expect(detail.record.items).toHaveLength(1);
  });
});

describe("storyboard authorized workspace loading", () => {
  it("loads project, script, workspace, and assets draft in parallel", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/storyboard/api-helpers.ts",
      ),
      "utf-8",
    );
    expect(source).toContain(
      "const [project, scriptDraft, existing, assetsDraft] = await Promise.all([",
    );
    expect(source).toContain("loadWorkspace(projectId)");
    expect(source).not.toMatch(
      /const scriptDraft = await loadScriptDraft\(projectId\);[\s\S]{0,120}const savedWorkspace = await updateWorkspaceUnderLock/,
    );
  });
});
