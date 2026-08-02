import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import {
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { SCRIPT_MARKDOWN_MAX_BYTES } from "@/projects/script/script-markdown-constants";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as importMd } from "@/app/api/projects/[projectId]/script-draft/import-markdown/route";
import { PUT as putDraft } from "@/app/api/projects/[projectId]/script-draft/route";

function auth(
  role: AuthUser["role"],
  id: string,
  username = id,
): AuthUser {
  return {
    id,
    username,
    role,
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mdRequest(
  projectId: string,
  text: string,
  fileName: string,
  mime = "text/markdown",
) {
  const form = new FormData();
  form.append("file", new File([text], fileName, { type: mime }));
  return new Request(
    `http://localhost/api/projects/${projectId}/script-draft/import-markdown`,
    { method: "POST", body: form },
  );
}

const THREE = [
  "# 第1集：初遇",
  "第一集正文。",
  "",
  "## 第2集：冲突",
  "第二集正文。",
  "",
  "### 第3集：转折",
  "第三集正文。",
].join("\n");

describe("script-draft import-markdown", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-script-md-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("OWNER parses markdown without mutating script.json", async () => {
    const owner = auth("user", "md-owner-1");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "m1",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const res = await importMd(mdRequest(project.projectId, THREE, "Story.MD"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      format: string;
      encoding: string;
      episodeCount: number;
      episodes: { title: string }[];
      sha256: string;
      warnings: string[];
    };
    expect(body.format).toBe("md");
    expect(body.encoding).toBe("utf-8");
    expect(body.episodeCount).toBe(3);
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.episodes[0]?.title).toContain("初遇");
    expect(JSON.stringify(body)).not.toMatch(/dangerouslySetInnerHTML|base64|C:\\\\/);
    expect(
      existsSync(
        path.join(tmp, "projects", project.projectId, "drafts", "script.json"),
      ),
    ).toBe(false);
  });

  it("SYSTEM_ADMIN and .markdown extension succeed", async () => {
    const admin = auth("admin", "md-admin-1");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: admin });
    const project = await createProjectRecord(admin.id, {
      name: "m-admin",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const res = await importMd(
      mdRequest(project.projectId, THREE, "story.markdown"),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { format: string }).format).toBe("md");
  });

  it("rejects disguised and wrong-route extensions", async () => {
    const owner = auth("user", "md-owner-ext");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "m-ext",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const ctx = { params: Promise.resolve({ projectId: project.projectId }) };
    for (const name of ["a.md.exe", "a.html", "a.txt", "a.docx"]) {
      expect(
        (await importMd(mdRequest(project.projectId, THREE, name), ctx)).status,
      ).toBe(400);
    }
  });

  it("CARD_ENGINEER 403; anon 401; stranger 403", async () => {
    const owner = auth("user", "md-owner-2");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "m2",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const engineer = auth("user", "md-ce");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const ctx = { params: Promise.resolve({ projectId: project.projectId }) };
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    expect(
      (await importMd(mdRequest(project.projectId, THREE, "a.md"), ctx)).status,
    ).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    expect(
      (await importMd(mdRequest(project.projectId, THREE, "a.md"), ctx)).status,
    ).toBe(401);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: auth("user", "md-stranger"),
    });
    expect(
      (await importMd(mdRequest(project.projectId, THREE, "a.md"), ctx)).status,
    ).toBe(403);
  });

  it("rejects wrong extension and oversize", async () => {
    const owner = auth("user", "md-owner-3");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "m3",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const ctx = { params: Promise.resolve({ projectId: project.projectId }) };
    expect(
      (await importMd(mdRequest(project.projectId, THREE, "a.txt"), ctx))
        .status,
    ).toBe(400);
    const huge = "a".repeat(SCRIPT_MARKDOWN_MAX_BYTES + 1);
    expect(
      (await importMd(mdRequest(project.projectId, huge, "big.md"), ctx))
        .status,
    ).toBe(413);
  });

  it("PUT persists format=md; same semantic TXT does not re-invalidate", async () => {
    const owner = auth("user", "md-owner-4");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "m4",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const pid = project.projectId;
    const now = new Date().toISOString();

    await saveScriptDraft({
      projectId: pid,
      sourceFile: null,
      sourceText: "旧",
      preambleNotes: null,
      sourceImport: null,
      novelTask: {
        id: "nt",
        projectId: pid,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep_old",
          projectId: pid,
          episodeNumber: 1,
          title: "旧",
          content: "旧",
          wordCount: 1,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep_old",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    });

    let ws = ensureEpisodeProductions(
      pid,
      [
        {
          id: "ep_old",
          projectId: pid,
          episodeNumber: 1,
          title: "旧",
          content: "旧",
          wordCount: 1,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      null,
    );
    ws = {
      ...ws,
      productions: ws.productions.map((p) => ({
        ...p,
        status: "storyboard_done" as const,
        currentStep: 2 as const,
        confirmedScriptText: "旧",
        activeStoryboard: {
          id: "sb1",
          version: 1,
          status: "confirmed" as const,
          sourceScriptHash: "h",
          sourceAssetSnapshotHash: "a",
          generationJobId: null,
          scenes: [],
          videoHistoryGenerationIds: ["gen_keep_md"],
          confirmedAt: now,
          confirmedBy: owner.id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      })),
    };
    await saveWorkspace(ws);

    const previewRes = await importMd(mdRequest(pid, THREE, "ep.md"), {
      params: Promise.resolve({ projectId: pid }),
    });
    const preview = (await previewRes.json()) as {
      sourceText: string;
      preamble: string;
      fileName: string;
      byteLength: number;
      sha256: string;
      mimeType: string | null;
      encoding: string;
      episodes: { id: string }[];
    };

    const put1 = await putDraft(
      new Request(`http://localhost/api/projects/${pid}/script-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: pid,
          sourceFile: {
            id: "f1",
            name: preview.fileName,
            type: "md",
            size: preview.byteLength,
            status: "uploaded",
          },
          sourceText: preview.sourceText,
          preambleNotes: preview.preamble || null,
          sourceImport: {
            format: "md",
            fileName: preview.fileName,
            mimeType: preview.mimeType,
            byteLength: preview.byteLength,
            sha256: preview.sha256,
            encoding: preview.encoding,
            importedAt: now,
          },
          novelTask: {
            id: "nt",
            projectId: pid,
            sourceFile: null,
            status: "uploaded",
            resultScriptId: null,
            createdAt: now,
          },
          episodes: preview.episodes,
          selectedId: preview.episodes[0]?.id,
          listPage: 1,
          splitConfig: {
            mode: "by-episode-count",
            totalEpisodes: 1,
            charsPerEpisode: 1500,
          },
          novelOpen: false,
        }),
      }),
      { params: Promise.resolve({ projectId: pid }) },
    );
    expect(put1.status).toBe(200);
    expect(((await put1.json()) as { invalidated: boolean }).invalidated).toBe(
      true,
    );

    const raw = JSON.parse(
      readFileSync(
        path.join(tmp, "projects", pid, "drafts", "script.json"),
        "utf8",
      ),
    ) as { sourceImport: { format: string; encoding?: string } };
    expect(raw.sourceImport.format).toBe("md");
    expect(raw.sourceImport.encoding).toBe("utf-8");

    const after = await loadWorkspace(pid);
    const old = after?.productions.find((p) => p.episodeId === "ep_old");
    expect(old?.storyboardStale).toBe(true);
    expect(old?.activeStoryboard?.videoHistoryGenerationIds).toEqual([
      "gen_keep_md",
    ]);

    const draft = await loadScriptDraft(pid);
    const putSame = await putDraft(
      new Request(`http://localhost/api/projects/${pid}/script-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          sourceFile: {
            id: "f2",
            name: "same.txt",
            type: "txt",
            size: 10,
            status: "uploaded",
          },
          sourceImport: {
            format: "txt",
            fileName: "same.txt",
            mimeType: "text/plain",
            byteLength: 10,
            sha256: "e".repeat(64),
            encoding: "utf-8",
            importedAt: new Date().toISOString(),
          },
        }),
      }),
      { params: Promise.resolve({ projectId: pid }) },
    );
    expect(
      ((await putSame.json()) as { invalidated: boolean }).invalidated,
    ).toBe(false);
  });
});
