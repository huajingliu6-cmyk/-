import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { loadStoryDraft, saveStoryDraft } from "@/text-generation/document-store";
import { getCreditBalance } from "@/text-generation/credits";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as postTextGen } from "@/app/api/projects/[projectId]/text-generations/route";
import { PUT as putStoryDraft } from "@/app/api/projects/[projectId]/story-draft/route";

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
  events: { event: string; data: Record<string, unknown> }[];
  text: string;
}> {
  const raw = await res.text();
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let text = "";
  for (const block of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataLines.join("\n") || "{}") as Record<string, unknown>;
    } catch {
      data = {};
    }
    events.push({ event, data });
    if (event === "delta" && typeof data.text === "string") text += data.text;
  }
  return { events, text };
}

describe("story text-generations integration", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-story-gen-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("OWNER streams story without mutating story-draft until PUT", async () => {
    const owner = auth("user", "story-owner-1");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "s1",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await saveStoryDraft({
      projectId: project.projectId,
      brief: "旧大纲",
      outputKind: "story",
      modelKey: "balanced-default",
      targetChars: 300,
      resultText: "旧故事正文",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const before = await loadStoryDraft(project.projectId);
    const balanceBefore = await getCreditBalance(owner.id);

    const res = await postTextGen(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "story",
            brief: "雨夜茶馆里的陌生人",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "story_idem_1",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/event-stream/);
    const { events, text } = await readSse(res);
    expect(events.some((e) => e.event === "done")).toBe(true);
    expect(events.some((e) => e.event === "error")).toBe(false);
    expect(text.length).toBeGreaterThan(0);

    const mid = await loadStoryDraft(project.projectId);
    expect(mid?.resultText).toBe("旧故事正文");
    expect(mid?.brief).toBe(before?.brief);

    const put = await putStoryDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/story-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief: "雨夜茶馆里的陌生人",
            outputKind: "story",
            modelKey: "balanced-default",
            targetChars: 200,
            resultText: text,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(put.status).toBe(200);
    const after = await loadStoryDraft(project.projectId);
    expect(after?.resultText).toBe(text);

    const balanceAfter = await getCreditBalance(owner.id);
    expect(balanceAfter).toBeLessThanOrEqual(balanceBefore);

    // idempotent replay should not fail
    const res2 = await postTextGen(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "story",
            brief: "雨夜茶馆里的陌生人",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "story_idem_1",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const sse2 = await readSse(res2);
    expect(sse2.events.some((e) => e.event === "done" || e.event === "meta")).toBe(
      true,
    );
    const balanceReplay = await getCreditBalance(owner.id);
    expect(balanceReplay).toBe(balanceAfter);
  });

  it("CARD_ENGINEER is forbidden; anon unauthorized", async () => {
    const owner = auth("user", "story-owner-2");
    const engineer = auth("user", "story-eng-2");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "s2",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    const { addCardEngineer } = await import("@/auth/project-members");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const engRes = await postTextGen(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "story",
            brief: "x",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "e1",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    // SSE may still return 200 with error event for role check
    const engSse = await readSse(engRes);
    const forbidden =
      engRes.status === 403 ||
      engSse.events.some(
        (e) => e.event === "error" && e.data.code === "FORBIDDEN",
      );
    expect(forbidden).toBe(true);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "未登录" }), {
        status: 401,
      }),
    } as never);
    const anon = await postTextGen(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "story",
            brief: "x",
            modelKey: "balanced-default",
            targetChars: 200,
            idempotencyKey: "a1",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(anon.status).toBe(401);
  });
});
