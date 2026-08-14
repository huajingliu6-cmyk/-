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
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { GET as getAssetDesigns } from "@/app/api/projects/[projectId]/asset-designs/route";
import {
  GET as getEpisodeDesign,
  PUT as putEpisodeDesign,
} from "@/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/route";
import { POST as postConfirm } from "@/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/confirm/route";
import { listEpisodeAssetDesigns } from "@/projects/assets/episode-design/episode-design-api";
import { SCRIPT_ASSET_DESIGN_ID } from "@/projects/assets/episode-design/types";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";

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

function baseDraft(projectId: string, now: string) {
  return {
    projectId,
    sourceFile: null,
    sourceText: null,
    preambleNotes: null,
    sourceImport: null,
    outlineText: null,
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
        id: "ep1",
        projectId,
        episodeNumber: 1,
        title: "第1集",
        content: "第一集正文",
        wordCount: 5,
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
}

describe("episode asset design routes", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ead-routes-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("owner can list merged episode designs", async () => {
    const owner = auth("user", "owner_ads");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ads-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));

    const res = await getAssetDesigns(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: Array<{ episodeId: string; designStatus: string }>;
    };
    expect(json.items).toHaveLength(1);
    expect(json.items[0]!.episodeId).toBe("ep1");
    expect(json.items[0]!.designStatus).toBe("not_started");
  });

  it("card engineer cannot access asset design routes", async () => {
    const owner = auth("user", "owner_ads_ce");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ads-ce-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const engineer = auth("user", "eng_ads");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });

    const res = await getAssetDesigns(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(res.status).toBe(403);
  });

  it("list ignores proposed split episodes until confirm-split writes formal episodes", async () => {
    const owner = auth("user", "owner_ads_proposed");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ads-prop-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      ...baseDraft(project.projectId, now),
      episodes: [],
      selectedId: null,
      episodeSplit: {
        status: "review",
        sourceFingerprint: "fp",
        generationId: "gen-1",
        proposedEpisodes: [
          {
            id: "prop-1",
            episodeNumber: 1,
            title: "待确认第1集",
            text: "待确认正文",
            contentFingerprint: "prop-fp",
          },
        ],
        generatedAt: now,
        confirmedAt: null,
        confirmedRevision: 0,
        errorMessage: null,
        lastConfirmIdempotencyKey: null,
      },
    });

    const items = await listEpisodeAssetDesigns(project.projectId);
    expect(items).toHaveLength(0);

    const res = await getAssetDesigns(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: unknown[] };
    expect(json.items).toHaveLength(0);
  });

  it("confirms one personal asset with its generated image", async () => {
    const owner = auth("user", "owner_ads_confirm");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ads-c-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    const fingerprint = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "第1集",
      content: "第一集正文",
    });
    const store = await loadEpisodeAssetDesignStore(project.projectId);
    await saveEpisodeAssetDesignStore(
      upsertEpisodeRecord(store, {
        episodeId: "ep1",
        episodeNumber: 1,
        status: "review",
        revision: 1,
        contentFingerprint: fingerprint,
        generationId: null,
        items: [
          {
            id: "i1",
            assetType: "scene",
            name: "新场景",
            resolution: "create_new",
            source: "ai",
            draft: {
              description: "描述",
              timeOfDay: "夜",
              location: "街道",
              style: "写实",
              usageInEpisode: "开场",
              evidence: "",
            },
          },
        ],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt: now,
      }),
    );

    const missingImageRes = await postConfirm(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1, fingerprint }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          episodeId: "ep1",
        }),
      },
    );
    expect(missingImageRes.status).toBe(400);
    expect((await missingImageRes.json()) as { code: string }).toMatchObject({
      code: "IMAGE_REQUIRED",
    });

    const latestStore = await loadEpisodeAssetDesignStore(project.projectId);
    const latestRecord = latestStore.records.find(
      (record) => record.episodeId === "ep1",
    )!;
    await saveEpisodeAssetDesignStore(
      upsertEpisodeRecord(latestStore, {
        ...latestRecord,
        items: latestRecord.items.map((item) => ({
          ...item,
          generatedMedia: {
            currentId: "gen_scene_1",
            historyIds: ["gen_scene_1"],
            history: [
              {
                mediaId: "gen_scene_1",
                prompt: "夜晚街道",
                generatedAt: now,
                mimeType: "image/webp",
              },
            ],
            status: "completed" as const,
            promptFingerprint: "prompt-fp",
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image" as const,
          },
        })),
      }),
    );

    const res = await postConfirm(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          fingerprint,
          itemId: "i1",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          episodeId: "ep1",
        }),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      counts: { created: number };
      record: EpisodeAssetDesignRecord;
    };
    expect(json.counts.created).toBe(1);
    expect(json.record.status).toBe("review");
    const bundle = await loadAssetBundleDraft(project.projectId);
    expect(bundle?.scenes[0]).toMatchObject({
      name: "新场景",
      imageFileName: "gen_scene_1",
      imageMimeType: "image/webp",
      primaryMediaId: "gen_scene_1",
      approvedMediaIds: ["gen_scene_1"],
      status: "completed",
    });

    const confirmAllRes = await postConfirm(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1, fingerprint }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          episodeId: "ep1",
        }),
      },
    );
    expect(confirmAllRes.status).toBe(200);
    const confirmAll = (await confirmAllRes.json()) as {
      counts: { created: number };
      record: EpisodeAssetDesignRecord;
    };
    expect(confirmAll.counts.created).toBe(0);
    expect(confirmAll.record.status).toBe("confirmed");
    expect((await loadAssetBundleDraft(project.projectId))?.scenes).toHaveLength(1);
  });

  it("PUT returns 409 on revision conflict", async () => {
    const owner = auth("user", "owner_ads_put");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `ads-p-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft(baseDraft(project.projectId, now));
    const fingerprint = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "第1集",
      content: "第一集正文",
    });

    const getRes = await getEpisodeDesign(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        episodeId: "ep1",
      }),
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      episode: { content?: string };
    };
    expect(getJson.episode.content).toBe("第一集正文");

    const put = await putEpisodeDesign(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 99,
          fingerprint,
          items: [],
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          episodeId: "ep1",
        }),
      },
    );
    expect(put.status).toBe(409);
    const json = (await put.json()) as { code: string };
    expect(json.code).toBe("REVISION_CONFLICT");

    const draft = await loadScriptDraft(project.projectId);
    expect(draft?.episodes[0]?.content).toBe("第一集正文");
  });

  it("returns sourceText as content for full-script design viewer", async () => {
    const owner = auth("user", "owner_full_script_view");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: `full-script-view-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const now = new Date().toISOString();
    await saveScriptDraft({
      ...baseDraft(project.projectId, now),
      sourceText: "完整原始上传剧本正文用于查看",
    });

    const getRes = await getEpisodeDesign(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        episodeId: SCRIPT_ASSET_DESIGN_ID,
      }),
    });
    expect(getRes.status).toBe(200);
    const json = (await getRes.json()) as {
      episode: { id: string; title: string; content?: string };
    };
    expect(json.episode.id).toBe(SCRIPT_ASSET_DESIGN_ID);
    expect(json.episode.title).toBe("完整原始剧本");
    expect(json.episode.content).toBe("完整原始上传剧本正文用于查看");
  });
});
