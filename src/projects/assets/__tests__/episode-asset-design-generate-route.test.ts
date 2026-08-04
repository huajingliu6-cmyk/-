import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { updateGenerationApiConfig } from "@/auth/api-config";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
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

async function readSseError(res: Response): Promise<string | undefined> {
  const raw = await res.text();
  for (const block of raw.split("\n\n")) {
    if (!block.includes("event: error")) continue;
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trimStart()) as { code?: string };
          return data.code;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return undefined;
}

describe("episode asset design text generation route", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ead-gen-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.TEXT_LLM_PROVIDER = "mock";
    vi.mocked(requireSessionUser).mockReset();
    await updateGenerationApiConfig("episode-asset-design-text", {
      provider: "mock",
      enabled: true,
    });
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("generates episode_asset_design for owner with episode content", async () => {
    const owner = auth("user", "owner_ead_gen");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ead-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
      sourceText: "全文不应进入 brief",
      preambleNotes: null,
      sourceImport: null,
      outlineText: "大纲也不应进入 brief",
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
          id: "ep_target",
          projectId: project.projectId,
          episodeNumber: 1,
          title: "目标集",
          content: "仅本集正文用于资产设计。",
          wordCount: 10,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "ep_other",
          projectId: project.projectId,
          episodeNumber: 2,
          title: "其他集",
          content: "其他集正文不得泄漏。",
          wordCount: 10,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep_target",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 2,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "episode_asset_design",
            brief: "",
            episodeId: "ep_target",
            modelKey: "balanced-default",
            targetChars: 500,
            idempotencyKey: `ead_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("event: meta");
    expect(raw).not.toContain("其他集正文不得泄漏");
    expect(raw).not.toContain("全文不应进入 brief");
  });

  it("generates script_asset_design from a full script over the normal brief limit", async () => {
    const owner = auth("user", "owner_script_asset_gen");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `script-assets-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
      sourceText: `完整剧本正文。${"角色进入场景并使用道具。".repeat(400)}`,
      preambleNotes: null,
      sourceImport: null,
      novelTask: {
        id: "nt",
        projectId: project.projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
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

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "script_asset_design",
            brief: "",
            modelKey: "balanced-default",
            targetChars: 20_000,
            idempotencyKey: `script_assets_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("event: meta");
    expect(raw).not.toContain('"code":"BRIEF_TOO_LONG"');
  });

  it("rejects when episode content empty", async () => {
    const owner = auth("user", "owner_ead_empty");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ead-empty-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
      sourceText: null,
      preambleNotes: null,
      sourceImport: null,
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
          id: "ep_empty",
          projectId: project.projectId,
          episodeNumber: 1,
          title: "空集",
          content: "  ",
          wordCount: 0,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep_empty",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });

    const res = await postTextGenerations(
      new Request(
        `http://localhost/api/projects/${project.projectId}/text-generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputKind: "episode_asset_design",
            brief: "",
            episodeId: "ep_empty",
            modelKey: "balanced-default",
            targetChars: 500,
            idempotencyKey: `ead_empty_${Date.now()}`,
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const code = await readSseError(res);
    expect(code).toBe("EPISODE_CONTENT_EMPTY");
  });
});
