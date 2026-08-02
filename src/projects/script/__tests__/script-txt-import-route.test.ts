import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
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
import { SCRIPT_TXT_MAX_BYTES } from "@/projects/script/script-txt-constants";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as importTxt } from "@/app/api/projects/[projectId]/script-draft/import-txt/route";
import {
  GET as getDraft,
  PUT as putDraft,
} from "@/app/api/projects/[projectId]/script-draft/route";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";

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

function txtRequest(
  projectId: string,
  bytes: Uint8Array,
  fileName: string,
  mime = "text/plain",
) {
  const form = new FormData();
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new File([copy], fileName, { type: mime }));
  return new Request(
    `http://localhost/api/projects/${projectId}/script-draft/import-txt`,
    { method: "POST", body: form },
  );
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("script-draft import-txt + persist", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-script-txt-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("ADMIN can parse without mutating script.json", async () => {
    const admin = auth("admin", "admin1");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    const project = await createProjectRecord(admin.id, {
      name: "s1",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const text = "第1集：初遇\n甲\n\n第2集：冲突\n乙\n\n第3集：转折\n丙";
    const res = await importTxt(
      txtRequest(project.projectId, utf8(text), "a.txt"),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      episodeCount: number;
      encoding: string;
      sha256: string;
      episodes: { title: string }[];
      fileName: string;
    };
    expect(body.episodeCount).toBe(3);
    expect(body.encoding).toBe("utf-8");
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.episodes.map((e) => e.title).join("|")).toContain("初遇");
    expect(JSON.stringify(body)).not.toMatch(/:[\\/]/);
    expect(
      existsSync(
        path.join(tmp, "projects", project.projectId, "drafts", "script.json"),
      ),
    ).toBe(false);
  });

  it("OWNER can parse; CARD_ENGINEER 403; anon 401", async () => {
    const owner = auth("user", "owner1");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: "s2",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const ok = await importTxt(
      txtRequest(project.projectId, utf8("无标题正文"), "b.txt"),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(ok.status).toBe(200);
    const parsed = (await ok.json()) as { episodeCount: number };
    expect(parsed.episodeCount).toBe(1);

    const engineer = auth("user", "ce1");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const denied = await importTxt(
      txtRequest(project.projectId, utf8("正文"), "c.txt"),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(denied.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    const anon = await importTxt(
      txtRequest(project.projectId, utf8("正文"), "d.txt"),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(anon.status).toBe(401);
  });

  it("rejects non-txt, empty, binary, oversize", async () => {
    const owner = auth("user", "owner2");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: "s3",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const pid = project.projectId;
    const ctx = { params: Promise.resolve({ projectId: pid }) };

    expect(
      (await importTxt(txtRequest(pid, utf8("x"), "a.docx"), ctx)).status,
    ).toBe(400);
    expect(
      (await importTxt(txtRequest(pid, new Uint8Array(), "a.txt"), ctx)).status,
    ).toBe(400);
    expect(
      (
        await importTxt(
          txtRequest(pid, Uint8Array.from([0x00, 0x01, 0x02, 0xff]), "bin.txt"),
          ctx,
        )
      ).status,
    ).toBe(400);

    const huge = new Uint8Array(SCRIPT_TXT_MAX_BYTES + 1);
    huge.fill(0x61);
    expect((await importTxt(txtRequest(pid, huge, "big.txt"), ctx)).status).toBe(
      413,
    );
  });

  it("PUT persists episodes + sourceImport and invalidates storyboard on change", async () => {
    const owner = auth("user", "owner3");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: "s4",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const pid = project.projectId;
    const now = new Date().toISOString();

    await saveScriptDraft({
      projectId: pid,
      sourceFile: null,
      sourceText: "旧剧本",
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
          content: "旧剧本",
          wordCount: 3,
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
          content: "旧剧本",
          wordCount: 3,
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
        confirmedScriptText: "旧剧本",
        activeStoryboard: {
          id: "sb1",
          version: 1,
          status: "confirmed" as const,
          sourceScriptHash: "h",
          sourceAssetSnapshotHash: "a",
          generationJobId: null,
          scenes: [],
          videoHistoryGenerationIds: ["gen_keep"],
          confirmedAt: now,
          confirmedBy: owner.id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      })),
    };
    await saveWorkspace(ws);

    const importRes = await importTxt(
      txtRequest(pid, utf8("第1集：新\n新正文内容足够长"), "new.txt"),
      { params: Promise.resolve({ projectId: pid }) },
    );
    const preview = (await importRes.json()) as {
      episodes: { id: string }[];
      sourceText: string;
      preamble: string;
      fileName: string;
      byteLength: number;
      sha256: string;
      encoding: string;
      mimeType: string | null;
    };

    const putRes = await putDraft(
      new Request(`http://localhost/api/projects/${pid}/script-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: pid,
          sourceFile: {
            id: "f1",
            name: preview.fileName,
            type: "txt",
            size: preview.byteLength,
            status: "uploaded",
          },
          sourceText: preview.sourceText,
          preambleNotes: preview.preamble || null,
          sourceImport: {
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
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { invalidated: boolean };
    expect(putBody.invalidated).toBe(true);

    const draftPath = path.join(
      tmp,
      "projects",
      pid,
      "drafts",
      "script.json",
    );
    const raw = JSON.parse(readFileSync(draftPath, "utf8")) as {
      episodes: { title: string }[];
      sourceText: string;
      sourceImport: { sha256: string; fileName: string };
    };
    expect(raw.episodes).toHaveLength(1);
    expect(raw.sourceText).toContain("新正文");
    expect(raw.sourceImport.sha256).toBe(preview.sha256);
    expect(JSON.stringify(raw)).not.toMatch(/blob:/);
    expect(JSON.stringify(raw)).not.toMatch(/base64/);
    expect(raw.sourceImport.fileName).toBe("new.txt");

    const after = await loadWorkspace(pid);
    const oldProd = after?.productions.find((p) => p.episodeId === "ep_old");
    expect(oldProd?.storyboardStale).toBe(true);
    expect(oldProd?.status).toBe("storyboard_incomplete");
    expect(oldProd?.activeStoryboard?.status).toBe("stale");
    expect(oldProd?.activeStoryboard?.videoHistoryGenerationIds).toEqual([
      "gen_keep",
    ]);

    const putSame = await putDraft(
      new Request(`http://localhost/api/projects/${pid}/script-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await loadScriptDraft(pid)),
          sourceImport: {
            fileName: preview.fileName,
            mimeType: preview.mimeType,
            byteLength: preview.byteLength,
            sha256: preview.sha256,
            encoding: preview.encoding,
            importedAt: new Date().toISOString(),
          },
        }),
      }),
      { params: Promise.resolve({ projectId: pid }) },
    );
    const sameBody = (await putSame.json()) as { invalidated: boolean };
    expect(sameBody.invalidated).toBe(false);

    const getRes = await getDraft(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: pid }),
    });
    const got = (await getRes.json()) as {
      draft: { episodes: unknown[]; sourceImport: unknown };
    };
    expect(got.draft.episodes).toHaveLength(1);
    expect(got.draft.sourceImport).toBeTruthy();
  });

  it("legacy draft without sourceImport still loads", async () => {
    const owner = auth("user", "owner4");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: "s5",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await saveScriptDraft({
      projectId: project.projectId,
      sourceFile: null,
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
    const draft = await loadScriptDraft(project.projectId);
    expect(draft?.sourceImport).toBeNull();
    expect(draft?.sourceText).toBeNull();
  });

  it("cross-project owner cannot import into other project", async () => {
    const ownerA = auth("user", "oa");
    const ownerB = auth("user", "ob");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: ownerA,
    });
    await createProjectRecord(ownerA.id, {
      name: "pa",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: ownerB,
    });
    const projectB = await createProjectRecord(ownerB.id, {
      name: "pb",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: ownerA,
    });
    const res = await importTxt(
      txtRequest(projectB.projectId, utf8("正文"), "x.txt"),
      { params: Promise.resolve({ projectId: projectB.projectId }) },
    );
    expect(res.status).toBe(403);
  });
});
