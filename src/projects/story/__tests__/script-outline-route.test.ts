import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { addCardEngineer } from "@/auth/project-members";
import {
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { scriptDraftContentChanged } from "@/projects/script/script-content-fingerprint";
import { saveStoryDraft } from "@/text-generation/document-store";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import {
  GET as getScriptDraft,
  PUT as putScriptDraft,
} from "@/app/api/projects/[projectId]/script-draft/route";
import { POST as postTextGenerations } from "@/app/api/projects/[projectId]/text-generations/route";

function auth(role: AuthUser["role"], id: string): AuthUser {
  return {
    id,
    username: id,
    role,
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function readSseText(res: Response): Promise<string> {
  const raw = await res.text();
  let text = "";
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (event === "delta") {
      try {
        const data = JSON.parse(dataLines.join("\n")) as { text?: string };
        if (data.text) text += data.text;
      } catch {
        /* ignore */
      }
    }
  }
  return text;
}

describe("script outline persistence + text-generations", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-outline-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.TEXT_LLM_PROVIDER = "mock";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("owner can generate script_outline via SSE without mutating script-draft", async () => {
    const owner = auth("user", "owner_ol");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `outline-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
      sourceText: "正式剧本原文",
      preambleNotes: null,
      sourceImport: {
        format: "txt",
        fileName: "a.txt",
        mimeType: "text/plain",
        byteLength: 18,
        sha256: "a".repeat(64),
        encoding: "utf-8",
        importedAt: now,
      },
      outlineText: "旧大纲",
      novelTask: {
        id: "nt",
        projectId: project.projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep1",
          projectId: project.projectId,
          episodeNumber: 1,
          title: "第1集",
          content: "正文集",
          wordCount: 3,
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
    await saveStoryDraft({
      projectId: project.projectId,
      brief: "旧故事",
      outputKind: "story",
      modelKey: "balanced-default",
      targetChars: 300,
      resultText: "故事正文",
      updatedAt: now,
    });

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_outline",
            brief: "雨夜复仇大纲材料",
            modelKey: "balanced-default",
            targetChars: 400,
            idempotencyKey: `outline_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const text = await readSseText(res);
    expect(text).toMatch(/故事核心|主线冲突|阶段推进/);

    const mid = await loadScriptDraft(project.projectId);
    expect(mid?.outlineText).toBe("旧大纲");
    expect(mid?.sourceText).toBe("正式剧本原文");
    expect(mid?.episodes[0]?.content).toBe("正文集");
  });

  it("applying outline only patches outlineText and does not invalidate", async () => {
    const owner = auth("user", "owner_ol2");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `outline2-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    const base = {
      projectId: project.projectId,
      sourceFile: null,
      sourceText: "正式剧本原文",
      preambleNotes: "前置",
      sourceImport: {
        format: "txt" as const,
        fileName: "a.txt",
        mimeType: "text/plain",
        byteLength: 18,
        sha256: "b".repeat(64),
        encoding: "utf-8" as const,
        importedAt: now,
      },
      outlineText: "旧大纲",
      novelTask: {
        id: "nt",
        projectId: project.projectId,
        sourceFile: null,
        status: "uploaded" as const,
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep1",
          projectId: project.projectId,
          episodeNumber: 1,
          title: "第1集",
          content: "正文集",
          wordCount: 3,
          status: "saved" as const,
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep1",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count" as const,
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    };
    await saveScriptDraft(base);
    await saveAssetBundleDraft({
      projectId: project.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    });
    await saveStoryDraft({
      projectId: project.projectId,
      brief: "keep",
      outputKind: "story",
      modelKey: "balanced-default",
      targetChars: 200,
      resultText: "story keep",
      updatedAt: now,
    });

    const previous = await loadScriptDraft(project.projectId);
    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...previous,
            outlineText: "【故事核心】新大纲内容",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(200);
    const body = (await put.json()) as { invalidated?: boolean };
    expect(body.invalidated).toBe(false);

    const after = await loadScriptDraft(project.projectId);
    expect(after?.outlineText).toBe("【故事核心】新大纲内容");
    expect(after?.sourceText).toBe("正式剧本原文");
    expect(after?.preambleNotes).toBe("前置");
    expect(after?.episodes).toEqual(previous?.episodes);
    expect(after?.sourceImport?.sha256).toBe("b".repeat(64));
    expect(scriptDraftContentChanged(previous, after!)).toBe(false);

    const storyPath = path.join(
      tmp,
      "projects",
      project.projectId,
      "drafts",
      "story.json",
    );
    expect(existsSync(storyPath)).toBe(true);
    expect(JSON.parse(readFileSync(storyPath, "utf-8")).resultText).toBe(
      "story keep",
    );
  });

  it("CARD_ENGINEER cannot call text-generations or put script-draft", async () => {
    const owner = auth("user", "owner_ol3");
    const engineer = auth("user", "eng_ol3");
    const project = await createProjectRecord(owner.id, {
      name: `outline3-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
      sourceText: null,
      preambleNotes: null,
      sourceImport: null,
      outlineText: null,
      novelTask: {
        id: "nt",
        projectId: project.projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: new Date().toISOString(),
      },
      episodes: [],
      selectedId: null,
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const gen = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_outline",
            brief: "x",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "k1",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(gen.status).toBe(200);
    const raw = await gen.text();
    expect(raw).toMatch(/FORBIDDEN|无权/);

    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.projectId,
            episodes: [],
            outlineText: "hack",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(403);

    const get = await getScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(get.status).toBe(403);
  });

  it("rejects unknown outputKind", async () => {
    const owner = auth("user", "owner_ol4");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `outline4-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "not_a_kind",
            brief: "x",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "bad",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toMatch(/INVALID_KIND|无效/);
  });
});
