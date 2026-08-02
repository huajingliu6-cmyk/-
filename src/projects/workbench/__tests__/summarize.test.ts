import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import { buildProjectWorkbenchSummary } from "@/projects/workbench/summarize";
import type { ProjectPublic } from "@/projects/types";
import { workflowEditorPath } from "@/shell/nav";

function projectPublic(
  overrides: Partial<ProjectPublic> = {},
): ProjectPublic {
  const now = new Date().toISOString();
  return {
    projectId: "p_wb_1",
    rootFolderId: "p_wb_1",
    name: "测试项目",
    ownerId: "u1",
    creationSource: "script-upload",
    projectMode: "full-stack",
    status: "draft",
    highlights: "",
    passwordEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("project workbench summarize", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-wb-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("maps story projects to /story and script-upload to /script", async () => {
    const story = await buildProjectWorkbenchSummary(
      projectPublic({ creationSource: "story", projectId: "p_story" }),
    );
    expect(story.stages.find((s) => s.id === "script")?.href).toBe(
      "/app/projects/p_story/story",
    );

    const script = await buildProjectWorkbenchSummary(
      projectPublic({ creationSource: "script-upload", projectId: "p_script" }),
    );
    expect(script.stages.find((s) => s.id === "script")?.href).toBe(
      "/app/projects/p_script/script",
    );
  });

  it("keeps assets and storyboard routes and omits video in full-stack mode", async () => {
    const summary = await buildProjectWorkbenchSummary(projectPublic());
    expect(summary.stages.find((s) => s.id === "assets")?.href).toContain(
      "/assets",
    );
    expect(summary.stages.find((s) => s.id === "storyboard")?.href).toContain(
      "/storyboard",
    );
    expect(summary.stages.find((s) => s.id === "video")).toBeUndefined();
  });

  it("includes disabled video stage in canvas mode until storyboard is confirmed", async () => {
    const summary = await buildProjectWorkbenchSummary(
      projectPublic({ projectMode: "canvas" }),
    );
    const video = summary.stages.find((s) => s.id === "video");
    expect(video?.enabled).toBe(false);
    expect(video?.actionLabel).toBe("进入视频制作画布");
    expect(video?.disabledReason).toContain("分镜");
    expect(video?.href).toBe(workflowEditorPath("p_wb_1"));
  });

  it("enables video canvas only after a storyboard is confirmed", async () => {
    const projectId = "p_wb_done";
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId,
      sourceFile: null,
      novelTask: {
        id: "nt",
        projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep1",
          projectId,
          episodeNumber: 1,
          title: "一",
          content: "内景 日\n林清出场。",
          wordCount: 10,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep1",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });
    await saveAssetBundleDraft({
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    });

    let ws = await loadWorkspace(projectId);
    ws = ensureEpisodeProductions(
      projectId,
      [
        {
          id: "ep1",
          projectId,
          episodeNumber: 1,
          title: "一",
          content: "内景 日\n林清出场。",
          wordCount: 10,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      ws,
    );
    ws = {
      ...ws,
      productions: ws.productions.map((p) => ({
        ...p,
        status: "storyboard_done" as const,
        currentStep: 2 as const,
      })),
    };
    await saveWorkspace(ws);

    const summary = await buildProjectWorkbenchSummary(
      projectPublic({
        projectId,
        rootFolderId: projectId,
        projectMode: "canvas",
      }),
    );
    const video = summary.stages.find((s) => s.id === "video");
    expect(video?.enabled).toBe(true);
    expect(video?.href).toBe(`/workflow?projectId=${projectId}`);
    expect(summary.hasConfirmedStoryboard).toBe(true);
  });

  it("continue creation does not jump to canvas when storyboard is done", async () => {
    const projectId = "p_wb_continue";
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId,
      sourceFile: null,
      novelTask: {
        id: "nt",
        projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep1",
          projectId,
          episodeNumber: 1,
          title: "一",
          content: "内容",
          wordCount: 2,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep1",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });
    await saveAssetBundleDraft({
      projectId,
      characters: [
        {
          id: "c1",
          projectId,
          name: "林清",
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
          status: "completed",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    let ws = await loadWorkspace(projectId);
    ws = ensureEpisodeProductions(
      projectId,
      [
        {
          id: "ep1",
          projectId,
          episodeNumber: 1,
          title: "一",
          content: "内容",
          wordCount: 2,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      ws,
    );
    ws = {
      ...ws,
      productions: ws.productions.map((p) => ({
        ...p,
        status: "storyboard_done" as const,
        currentStep: 2 as const,
      })),
    };
    await saveWorkspace(ws);

    const summary = await buildProjectWorkbenchSummary(
      projectPublic({ projectId, rootFolderId: projectId }),
    );
    expect(summary.continueCreation.href).toBe(`/app/projects/${projectId}`);
    expect(summary.continueCreation.href).not.toContain("/workflow");
  });
});
