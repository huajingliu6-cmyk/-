import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { loadWorkspaceSnapshot } from "@/projects/workspace-sync/store";
import { formatScriptAutoSplitNote, scriptShowsFormalEpisodeList } from "@/projects/script/script-auto-split-ui";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { PUT as putDraft } from "@/app/api/projects/[projectId]/script-draft/route";
import { POST as localSplit } from "@/app/api/projects/[projectId]/script-draft/local-split/route";
import { POST as confirmSplit } from "@/app/api/projects/[projectId]/script-draft/confirm-split/route";
import { GET as getWorkspaceScriptDraft } from "@/app/api/workspace/projects/[projectId]/script-draft/route";

function auth(id: string, username = id): AuthUser {
  return {
    id,
    username,
    role: "user",
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const TITLED_SCRIPT = [
  "第1集：开端",
  "甲乙对话。",
  "",
  "第2集：冲突",
  "冲突升级。",
  "",
  "第3集：收束",
  "终局。",
].join("\n");

function putAutoSplitRequest(
  projectId: string,
  sourceText: string,
  extra: Record<string, unknown> = {},
) {
  return new Request(
    `http://localhost/api/projects/${projectId}/script-draft`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": extra.operationId
          ? String(extra.operationId)
          : `op_autosplit_${projectId}`,
      },
      body: JSON.stringify({
        projectId,
        autoSplit: true,
        sourceText,
        sourceFile: {
          id: "f1",
          name: "script.txt",
          type: "txt",
          size: sourceText.length,
          status: "uploaded",
        },
        preambleNotes: null,
        sourceImport: {
          format: "txt",
          fileName: "script.txt",
          mimeType: "text/plain",
          byteLength: sourceText.length,
          sha256: "a".repeat(64),
          encoding: "utf-8",
          importedAt: "2026-08-18T00:00:00.000Z",
        },
        novelTask: {
          id: `novel-task-${projectId}`,
          projectId,
          sourceFile: null,
          status: "uploaded",
          resultScriptId: null,
          createdAt: "2026-08-18T00:00:00.000Z",
        },
        episodes: [],
        selectedId: null,
        listPage: 1,
        splitConfig: {
          mode: "by-episode-count",
          totalEpisodes: 3,
          charsPerEpisode: 800,
        },
        novelOpen: false,
        ...extra,
      }),
    },
  );
}

describe("script upload auto-split", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  let tmp = "";

  beforeEach(() => {
    const root =
      process.env.IC_TEST_TMP_ROOT ||
      path.join("E:", "DevWorkspace", "runtime", "test-tmp");
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, "ic-script-autosplit-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(async () => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function seedProject(ownerId: string, name: string) {
    const owner = auth(ownerId);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    return createProjectRecord(owner.id, {
      name,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
  }

  it("titled script upload auto-creates matching formal episodes", async () => {
    const project = await seedProject("owner-auto-1", "auto-split-titled");
    const res = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: {
        episodes: { episodeNumber: number; title: string; content: string }[];
        episodeSplit: { status: string };
      };
      confirmed: boolean;
      idempotent: boolean;
      mode: string;
    };
    expect(body.confirmed).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.mode).toBe("title");
    expect(body.draft.episodeSplit.status).toBe("confirmed");
    expect(body.draft.episodes).toHaveLength(3);
    expect(body.draft.episodes.map((ep) => ep.episodeNumber)).toEqual([1, 2, 3]);
    expect(body.draft.episodes[0]?.content).toContain("甲乙对话");
    expect(body.draft.episodes[1]?.content).toContain("冲突升级");
    expect(body.draft.episodes[2]?.content).toContain("终局");

    const stored = await loadScriptDraft(project.projectId);
    expect(stored?.episodes).toHaveLength(3);
  });

  it("retry / refresh with the same source fingerprint does not duplicate episodes", async () => {
    const project = await seedProject("owner-auto-2", "auto-split-retry");
    const first = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT, {
        operationId: "op_retry_a",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      draft: { episodes: { id: string; content: string }[] };
    };
    const ids = firstBody.draft.episodes.map((ep) => ep.id);

    const second = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT, {
        operationId: "op_retry_b",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      idempotent: boolean;
      draft: { episodes: { id: string; content: string }[] };
    };
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.draft.episodes.map((ep) => ep.id)).toEqual(ids);

    const local = await localSplit(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft/local-split`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "op_retry_local",
          },
          body: "{}",
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(local.status).toBe(200);
    const localBody = (await local.json()) as {
      idempotent: boolean;
      draft: { episodes: { id: string }[] };
    };
    expect(localBody.idempotent).toBe(true);
    expect(localBody.draft.episodes.map((ep) => ep.id)).toEqual(ids);
  });

  it("unrecognizable split returns a visible failed status, not silent success", async () => {
    const project = await seedProject("owner-auto-3", "auto-split-empty");
    const emptyTitles = "第1集：\n\n第2集：\n";
    const res = await putDraft(
      putAutoSplitRequest(project.projectId, emptyTitles),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      error: string;
      draft: { episodes: unknown[]; episodeSplit: { status: string; errorMessage: string | null } };
    };
    expect(body.code).toBe("LOCAL_SPLIT_EMPTY");
    expect(body.error).toContain("无法识别分集");
    expect(body.draft.episodes).toHaveLength(0);
    expect(body.draft.episodeSplit.status).toBe("failed");
    expect(body.draft.episodeSplit.errorMessage).toContain("无法识别分集");
  });

  it("does not overwrite existing episodes or production on a different script", async () => {
    const project = await seedProject("owner-auto-4", "auto-split-preserve");
    const first = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT, {
        operationId: "op_preserve_a",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const firstBody = (await first.json()) as {
      draft: { episodes: { id: string; title: string; content: string }[] };
    };
    const original = firstBody.draft.episodes;

    const { normalizeWorkspace, saveWorkspace, loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    const ws = normalizeWorkspace(project.projectId, {
      activeEpisodeId: original[0]!.id,
      productions: [
        {
          id: "prod_keep",
          episodeId: original[0]!.id,
          episodeNumber: 1,
          currentStep: 2,
          status: "storyboard_incomplete",
          confirmedScriptText: original[0]!.content,
          confirmedScriptRevision: 1,
          assetsStale: false,
          storyboardStale: false,
        },
      ],
    });
    await saveWorkspace(ws!);

    const otherScript = [
      "第1集：另一本",
      "完全不同的正文。",
    ].join("\n");
    const second = await putDraft(
      putAutoSplitRequest(project.projectId, otherScript, {
        operationId: "op_preserve_b",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as {
      code: string;
      draft: { episodes: { id: string; title: string }[] };
    };
    expect(secondBody.code).toBe("EXISTING_EPISODES_PRESERVED");
    expect(secondBody.draft.episodes.map((ep) => ep.id)).toEqual(
      original.map((ep) => ep.id),
    );
    expect(secondBody.draft.episodes[0]?.title).toBe(original[0]?.title);

    const stored = await loadScriptDraft(project.projectId);
    expect(stored?.episodes.map((ep) => ep.id)).toEqual(
      original.map((ep) => ep.id),
    );
    const production = await loadWorkspace(project.projectId);
    expect(production?.productions[0]?.id).toBe("prod_keep");
    expect(production?.productions[0]?.episodeId).toBe(original[0]?.id);
    expect(production?.productions[0]?.confirmedScriptText).toBe(
      original[0]?.content,
    );
  });

  it("replaceExisting auto-split overwrites prior episodes with a new script", async () => {
    const project = await seedProject("owner-auto-replace", "auto-split-replace");
    const first = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(first.status).toBe(200);

    const otherScript = ["第1集：新剧本", "全新正文。"].join("\n");
    const second = await putDraft(
      putAutoSplitRequest(project.projectId, otherScript, {
        replaceExisting: true,
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      draft: { episodes: { title: string; content: string }[] };
    };
    expect(secondBody.draft.episodes).toHaveLength(1);
    expect(secondBody.draft.episodes[0]?.title).toBe("第1集：新剧本");
    expect(secondBody.draft.episodes[0]?.content).toContain("全新正文");
  });

  it("clearScript removes uploaded source and episodes", async () => {
    const project = await seedProject("owner-auto-clear", "auto-split-clear");
    const first = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(first.status).toBe(200);

    const cleared = await putDraft(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.projectId, clearScript: true }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as {
      draft: {
        sourceFile: unknown;
        sourceText: string | null;
        episodes: unknown[];
      };
    };
    expect(body.draft.sourceFile).toBeNull();
    expect(body.draft.sourceText).toBeNull();
    expect(body.draft.episodes).toHaveLength(0);
  });

  it("management auto-split is visible on the workspace script-draft snapshot", async () => {
    const project = await seedProject("owner-auto-5", "auto-split-ws");
    const res = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const snapshot = await loadWorkspaceSnapshot(project.projectId);
    expect(snapshot?.episodes).toHaveLength(3);
    expect(snapshot?.episodes.map((ep) => ep.title)).toEqual(
      (await loadScriptDraft(project.projectId))?.episodes.map((ep) => ep.title),
    );

    const wsRes = await getWorkspaceScriptDraft(
      new Request(
        `http://localhost/api/workspace/projects/${project.projectId}/script-draft`,
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(wsRes.status).toBe(200);
    const wsBody = (await wsRes.json()) as {
      draft: { episodes: { title: string }[] };
    };
    expect(wsBody.draft.episodes).toHaveLength(3);
  });

  it("auto-split saves draft and syncs workspace without operation protocol", async () => {
    const project = await seedProject("owner-auto-7", "auto-split-protocol");
    const { normalizeWorkspace, saveWorkspace, loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    const { loadWorkspaceSnapshot } = await import(
      "@/projects/workspace-sync/store"
    );
    const seeded = normalizeWorkspace(project.projectId, {
      productions: [],
    });
    await saveWorkspace(seeded!);
    const res = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: { episodes: { id: string }[] };
    };
    expect(body.draft.episodes.length).toBeGreaterThan(0);
    const snapshot = await loadWorkspaceSnapshot(project.projectId);
    expect(snapshot).not.toBeNull();
    expect((await loadWorkspace(project.projectId))?.productions).toBeTruthy();
  });

  it("same operationId retry is CAS/idempotent and does not rewrite episode ids", async () => {
    const project = await seedProject("owner-auto-8", "auto-split-cas");
    const req = () =>
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT, {
        operationId: "op_cas_same",
      });
    const first = await putDraft(req(), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      draft: { episodes: { id: string }[]; documentRevision?: number };
    };
    const second = await putDraft(req(), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      draft: { episodes: { id: string }[]; documentRevision?: number };
    };
    expect(secondBody.draft.episodes.map((ep) => ep.id)).toEqual(
      firstBody.draft.episodes.map((ep) => ep.id),
    );
  });

  it("confirm-split with a new key is idempotent for the same source fingerprint", async () => {
    const project = await seedProject("owner-auto-6", "auto-split-confirm");
    const putRes = await putDraft(
      putAutoSplitRequest(project.projectId, TITLED_SCRIPT, {
        operationId: "op_confirm_put",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    const putBody = (await putRes.json()) as {
      draft: {
        episodes: { id: string }[];
        episodeSplit: { confirmedRevision: number; sourceFingerprint: string };
      };
    };
    const fingerprint =
      putBody.draft.episodeSplit.sourceFingerprint ||
      getScriptSourceFingerprint(TITLED_SCRIPT)!;
    const res = await confirmSplit(
      new Request(
        `http://localhost/api/projects/${project.projectId}/script-draft/confirm-split`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "op_confirm_retry",
          },
          body: JSON.stringify({
            sourceFingerprint: fingerprint,
            confirmedRevision: putBody.draft.episodeSplit.confirmedRevision,
            idempotencyKey: "split_confirm_other_key",
          }),
        },
      ),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      idempotent: boolean;
      draft: { episodes: { id: string }[] };
    };
    expect(body.idempotent).toBe(true);
    expect(body.draft.episodes.map((ep) => ep.id)).toEqual(
      putBody.draft.episodes.map((ep) => ep.id),
    );
  });

  it("ordinary success copy is withheld when downstream sync is pending or failed", () => {
    expect(
      formatScriptAutoSplitNote({
        episodeCount: 3,
        mode: "title",
        downstreamSync: "pending",
      }),
    ).toContain("工作台同步进行中");
    expect(
      formatScriptAutoSplitNote({
        episodeCount: 3,
        mode: "title",
        downstreamSync: "failed",
      }),
    ).toContain("工作台同步失败");
    expect(
      formatScriptAutoSplitNote({
        episodeCount: 3,
        mode: "title",
        downstreamSync: "ok",
      }),
    ).toMatch(/已自动分集/);
    expect(
      formatScriptAutoSplitNote({
        episodeCount: 3,
        mode: "title",
        downstreamSync: "ok",
      }),
    ).not.toContain("同步进行中");
  });

  it("UI helper shows the formal episode list after a confirmed auto-split", () => {
    expect(
      scriptShowsFormalEpisodeList({
        splitStatus: "confirmed",
        formalEpisodeCount: 3,
      }),
    ).toBe(true);
    expect(
      scriptShowsFormalEpisodeList({
        splitStatus: "failed",
        formalEpisodeCount: 0,
      }),
    ).toBe(false);
    expect(
      scriptShowsFormalEpisodeList({
        splitStatus: "review",
        formalEpisodeCount: 0,
      }),
    ).toBe(false);
  });
});
