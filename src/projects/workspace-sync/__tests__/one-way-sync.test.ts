import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalAssets,
} from "@/projects/workspace-sync/store";

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
});
