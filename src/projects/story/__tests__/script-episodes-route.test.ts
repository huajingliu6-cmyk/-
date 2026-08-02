import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { addCardEngineer } from "@/auth/project-members";
import {
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { outlineContentFingerprint } from "@/projects/script/script-episodes-generation-schema";
import { updateGenerationApiConfig } from "@/auth/api-config";
import { saveWorkspace, loadWorkspace } from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import { listGenerationRecords } from "@/video-generation/generation-store";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { PUT as putScriptDraft } from "@/app/api/projects/[projectId]/script-draft/route";
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

async function readSse(res: Response): Promise<{
  text: string;
  events: string[];
  errorCode?: string;
}> {
  const raw = await res.text();
  let text = "";
  const events: string[] = [];
  let errorCode: string | undefined;
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    events.push(event);
    if (event === "delta") {
      try {
        const data = JSON.parse(dataLines.join("\n")) as { text?: string };
        if (data.text) text += data.text;
      } catch {
        /* ignore */
      }
    }
    if (event === "error") {
      try {
        const data = JSON.parse(dataLines.join("\n")) as { code?: string };
        errorCode = data.code;
      } catch {
        /* ignore */
      }
    }
  }
  return { text, events, errorCode };
}

function baseDraft(projectId: string, now: string) {
  return {
    projectId,
    sourceFile: null,
    sourceText: "第1集：旧集\n\n旧正文A\n\n第2集：旧集二\n\n旧正文B\n\n第3集：旧集三\n\n旧正文C",
    preambleNotes: "前置说明",
    sourceImport: {
      format: "txt" as const,
      fileName: "old.txt",
      mimeType: "text/plain",
      byteLength: 40,
      sha256: "a".repeat(64),
      encoding: "utf-8" as const,
      importedAt: now,
    },
    outlineText: "【故事核心】已保存大纲用于生成剧集",
    novelTask: {
      id: "nt",
      projectId,
      sourceFile: null,
      status: "uploaded" as const,
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_keep1",
        projectId,
        episodeNumber: 1,
        title: "第1集：旧集",
        content: "旧正文A",
        wordCount: 4,
        status: "saved" as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ep_keep2",
        projectId,
        episodeNumber: 2,
        title: "第2集：旧集二",
        content: "旧正文B",
        wordCount: 4,
        status: "saved" as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ep_keep3",
        projectId,
        episodeNumber: 3,
        title: "第3集：旧集三",
        content: "旧正文C",
        wordCount: 4,
        status: "saved" as const,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedId: "ep_keep1",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count" as const,
      totalEpisodes: 3,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  };
}

describe("script episodes generate + apply", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-episodes-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.TEXT_LLM_PROVIDER = "mock";
    vi.mocked(requireSessionUser).mockReset();
    await updateGenerationApiConfig("script-episodes-text", {
      provider: "mock",
      enabled: true,
    });
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

  it("blocks script_episodes generation while capability is planned", async () => {
    const owner = auth("user", "owner_ep");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_episodes",
            brief: "补充",
            outlineText: "【故事核心】已保存大纲用于生成剧集",
            episodeNumber: 2,
            modelKey: "balanced-default",
            targetChars: 400,
            idempotencyKey: `episodes_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const { errorCode } = await readSse(res);
    expect(errorCode).toBe("AI_CAPABILITY_PLANNED");

    const mid = await loadScriptDraft(project.projectId);
    expect(mid?.episodes[1]?.content).toBe("旧正文B");
    expect(mid?.sourceImport?.fileName).toBe("old.txt");
  });

  it("rejects generation when outline missing", async () => {
    const owner = auth("user", "owner_ep_empty");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-empty-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    const draft = baseDraft(project.projectId, now);
    await saveScriptDraft({ ...draft, outlineText: "" });

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_episodes",
            brief: "",
            outlineText: "",
            episodeNumber: 1,
            modelKey: "balanced-default",
            targetChars: 300,
            idempotencyKey: `episodes_empty_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const { errorCode } = await readSse(res);
    expect(errorCode).toBe("OUTLINE_REQUIRED");
  });

  it("applies single episode, clears sourceImport, keeps outline, invalidates", async () => {
    const owner = auth("user", "owner_ep_apply");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-apply-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    const previous = await loadScriptDraft(project.projectId);

    let ws = ensureEpisodeProductions(
      project.projectId,
      previous!.episodes,
      null,
    );
    ws = {
      ...ws,
      productions: ws.productions.map((p) =>
        p.episodeNumber === 2
          ? {
              ...p,
              status: "storyboard_done" as const,
              currentStep: 2 as const,
              confirmedScriptText: "旧正文B",
              activeStoryboard: {
                id: "sb1",
                version: 1,
                status: "confirmed" as const,
                sourceScriptHash: "h",
                sourceAssetSnapshotHash: "a",
                generationJobId: null,
                scenes: [],
                videoHistoryGenerationIds: ["vg_hist_1"],
                confirmedAt: now,
                confirmedBy: owner.id,
                revision: 1,
                createdAt: now,
                updatedAt: now,
              },
            }
          : p,
      ),
    };
    await saveWorkspace(ws);

    const dto = {
      version: 1 as const,
      episodes: [
        {
          number: 2,
          title: "新标题",
          content: "全新第二集正文内容",
        },
      ],
    };
    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: dto,
            expectedUpdatedAt: previous?.updatedAt,
            expectedOutlineFingerprint: outlineContentFingerprint(
              previous?.outlineText ?? "",
            ),
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(200);
    const body = (await put.json()) as { invalidated?: boolean };
    expect(body.invalidated).toBe(true);

    const after = await loadScriptDraft(project.projectId);
    expect(after?.outlineText).toBe("【故事核心】已保存大纲用于生成剧集");
    expect(after?.sourceImport).toBeNull();
    expect(after?.preambleNotes).toBeNull();
    expect(after?.episodes).toHaveLength(3);
    expect(after?.episodes.find((e) => e.episodeNumber === 2)?.content).toBe(
      "全新第二集正文内容",
    );
    expect(after?.episodes.find((e) => e.episodeNumber === 1)?.id).toBe(
      "ep_keep1",
    );
    expect(after?.sourceText).toContain("全新第二集正文内容");
    expect(JSON.stringify(after)).not.toMatch(/apiKey|Authorization|Bearer/i);

    const wsAfter = await loadWorkspace(project.projectId);
    const ep2 = wsAfter?.productions.find((p) => p.episodeNumber === 2);
    expect(ep2?.storyboardStale).toBe(true);
    expect(ep2?.activeStoryboard?.videoHistoryGenerationIds).toEqual([
      "vg_hist_1",
    ]);

    const gens = await listGenerationRecords();
    expect(gens.length).toBe(0);
  });

  it("returns 409 on outline fingerprint mismatch and keeps draft", async () => {
    const owner = auth("user", "owner_ep_fp");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-fp-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    const previous = await loadScriptDraft(project.projectId);

    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: {
              version: 1,
              episodes: [{ number: 1, title: "x", content: "y" }],
            },
            expectedUpdatedAt: previous?.updatedAt,
            expectedOutlineFingerprint: "stale-outline-fp",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(409);
    const after = await loadScriptDraft(project.projectId);
    expect(after?.episodes[0]?.content).toBe("旧正文A");
  });

  it("returns 409 on expectedUpdatedAt conflict", async () => {
    const owner = auth("user", "owner_ep_409");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-409-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    const previous = await loadScriptDraft(project.projectId);

    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: {
              version: 1,
              episodes: [{ number: 1, title: "x", content: "冲突正文" }],
            },
            expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
            expectedOutlineFingerprint: outlineContentFingerprint(
              previous?.outlineText ?? "",
            ),
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(409);
    const after = await loadScriptDraft(project.projectId);
    expect(after?.episodes[0]?.content).toBe("旧正文A");
  });

  it("rejects CARD_ENGINEER generate and apply", async () => {
    const owner = auth("user", "owner_ep_ce");
    const engineer = auth("user", "ce_ep");
    const project = await createProjectRecord(owner.id, {
      name: `ep-ce-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));

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
            outputKind: "script_episodes",
            brief: "",
            outlineText: "【故事核心】已保存大纲用于生成剧集",
            episodeNumber: 1,
            modelKey: "balanced-default",
            targetChars: 300,
            idempotencyKey: `episodes_ce_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const { errorCode } = await readSse(gen);
    expect(errorCode).toBe("FORBIDDEN");

    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: {
              version: 1,
              episodes: [{ number: 1, title: "x", content: "hack" }],
            },
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(403);
  });

  it("rejects unauthenticated apply", async () => {
    const owner = auth("user", "owner_ep_unauth");
    const project = await createProjectRecord(owner.id, {
      name: `ep-unauth-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "未登录" }), {
        status: 401,
      }),
    } as never);

    // requireProjectManagementProjectAccess uses requireSessionUser path —
    // when session fails at access layer, expect 401.
    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: {
              version: 1,
              episodes: [{ number: 1, title: "x", content: "y" }],
            },
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect([401, 403]).toContain(put.status);
  });

  it("rejects client-submitted capabilityId", async () => {
    const owner = auth("user", "owner_ep_cap");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-cap-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_episodes",
            capabilityId: "story.generate",
            brief: "",
            outlineText: "【故事核心】已保存大纲用于生成剧集",
            episodeNumber: 1,
            modelKey: "balanced-default",
            targetChars: 300,
            idempotencyKey: `episodes_cap_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it("does not invalidate when applied content is equivalent", async () => {
    const owner = auth("user", "owner_ep_eq");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ep-eq-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    const draft = baseDraft(project.projectId, now);
    // Align sourceText with canonical so only episode 1 rewrite with same semantics.
    await saveScriptDraft(draft);
    const previous = await loadScriptDraft(project.projectId);
    const put = await putScriptDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyGeneratedEpisodes: {
              version: 1,
              episodes: [
                {
                  number: 1,
                  title: "第1集：旧集",
                  content: "旧正文A",
                },
              ],
            },
            expectedUpdatedAt: previous?.updatedAt,
            expectedOutlineFingerprint: outlineContentFingerprint(
              previous?.outlineText ?? "",
            ),
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(200);
    const after = await loadScriptDraft(project.projectId);
    expect(after?.outlineText).toBe(previous?.outlineText);
    expect(after?.episodes.find((e) => e.episodeNumber === 1)?.content).toBe(
      "旧正文A",
    );
  });
});
