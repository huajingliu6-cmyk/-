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
import { buildThreeEpisodeDocxWithSplitTitle } from "@/projects/script/__tests__/docx-fixture";
import { buildMinimalDocx } from "@/projects/script/__tests__/docx-fixture";
import { SCRIPT_DOCX_MAX_BYTES } from "@/projects/script/script-docx-constants";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import { scriptDraftContentChanged } from "@/projects/script/script-content-fingerprint";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as importDocx } from "@/app/api/projects/[projectId]/script-draft/import-docx/route";
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

function docxRequest(projectId: string, bytes: Uint8Array, fileName: string, mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
  const form = new FormData();
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new File([copy], fileName, { type: mime }));
  return new Request(
    `http://localhost/api/projects/${projectId}/script-draft/import-docx`,
    { method: "POST", body: form },
  );
}

describe("script-draft import-docx", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-script-docx-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("OWNER parses DOCX without mutating script.json", async () => {
    const owner = auth("user", "docx-owner-1");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "d1",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const bytes = await buildThreeEpisodeDocxWithSplitTitle();
    const res = await importDocx(
      docxRequest(project.projectId, bytes, "Story.DOCX", ""),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      format: string;
      episodeCount: number;
      encoding?: string;
      sha256: string;
      episodes: { title: string }[];
    };
    expect(body.format).toBe("docx");
    expect(body.episodeCount).toBe(3);
    expect(body.encoding).toBeUndefined();
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.episodes[0]?.title).toContain("开端");
    expect(JSON.stringify(body)).not.toMatch(/<[wW]:/);
    expect(JSON.stringify(body)).not.toMatch(/base64/);
    expect(
      existsSync(
        path.join(tmp, "projects", project.projectId, "drafts", "script.json"),
      ),
    ).toBe(false);
  });

  it("CARD_ENGINEER 403; anon 401; stranger 403", async () => {
    const owner = auth("user", "docx-owner-2");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "d2",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const bytes = await buildMinimalDocx([{ type: "p", runs: ["整篇无标题正文"] }]);
    const engineer = auth("user", "docx-ce");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    expect(
      (
        await importDocx(docxRequest(project.projectId, bytes, "a.docx"), {
          params: Promise.resolve({ projectId: project.projectId }),
        })
      ).status,
    ).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    expect(
      (
        await importDocx(docxRequest(project.projectId, bytes, "a.docx"), {
          params: Promise.resolve({ projectId: project.projectId }),
        })
      ).status,
    ).toBe(401);

    const stranger = auth("user", "docx-stranger");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: stranger,
    });
    expect(
      (
        await importDocx(docxRequest(project.projectId, bytes, "a.docx"), {
          params: Promise.resolve({ projectId: project.projectId }),
        })
      ).status,
    ).toBe(403);
  });

  it("rejects non-docx name and oversize", async () => {
    const owner = auth("user", "docx-owner-3");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "d3",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const bytes = await buildMinimalDocx([{ type: "p", runs: ["正文"] }]);
    const ctx = { params: Promise.resolve({ projectId: project.projectId }) };
    expect(
      (await importDocx(docxRequest(project.projectId, bytes, "a.doc"), ctx))
        .status,
    ).toBe(400);
    const huge = new Uint8Array(SCRIPT_DOCX_MAX_BYTES + 1);
    huge[0] = 0x50;
    huge[1] = 0x4b;
    huge[2] = 0x03;
    huge[3] = 0x04;
    expect(
      (await importDocx(docxRequest(project.projectId, huge, "big.docx"), ctx))
        .status,
    ).toBe(413);
  });

  it("PUT persists format=docx and invalidates; same content TXT does not re-invalidate", async () => {
    const owner = auth("user", "docx-owner-4");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "d4",
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
          videoHistoryGenerationIds: ["gen_keep_docx"],
          confirmedAt: now,
          confirmedBy: owner.id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      })),
    };
    await saveWorkspace(ws);

    const bytes = await buildThreeEpisodeDocxWithSplitTitle();
    const previewRes = await importDocx(
      docxRequest(pid, bytes, "ep.docx"),
      { params: Promise.resolve({ projectId: pid }) },
    );
    const preview = (await previewRes.json()) as {
      sourceText: string;
      preamble: string;
      fileName: string;
      byteLength: number;
      sha256: string;
      mimeType: string | null;
      episodes: { id: string }[];
      format: string;
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
            type: "docx",
            size: preview.byteLength,
            status: "uploaded",
          },
          sourceText: preview.sourceText,
          preambleNotes: preview.preamble || null,
          sourceImport: {
            format: "docx",
            fileName: preview.fileName,
            mimeType: preview.mimeType,
            byteLength: preview.byteLength,
            sha256: preview.sha256,
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
    ) as {
      sourceImport: { format: string; encoding?: string };
      sourceText: string;
    };
    expect(raw.sourceImport.format).toBe("docx");
    expect(raw.sourceImport.encoding).toBeUndefined();
    expect(raw.sourceText).toContain("第一集：开端");

    const after = await loadWorkspace(pid);
    const old = after?.productions.find((p) => p.episodeId === "ep_old");
    expect(old?.storyboardStale).toBe(true);
    expect(old?.activeStoryboard?.videoHistoryGenerationIds).toEqual([
      "gen_keep_docx",
    ]);

    const draft = await loadScriptDraft(pid);
    expect(draft).toBeTruthy();
    // Same semantic content as TXT → fingerprint unchanged → no invalidate
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
            sha256: "d".repeat(64),
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

    expect(
      scriptDraftContentChanged(draft, {
        episodes: draft!.episodes,
        sourceText: draft!.sourceText,
        preambleNotes: draft!.preambleNotes,
      }),
    ).toBe(false);
  });
});
