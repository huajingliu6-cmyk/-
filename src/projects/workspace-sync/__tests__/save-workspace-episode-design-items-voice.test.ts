import { beforeEach, describe, expect, it, vi } from "vitest";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import { withDesignMediaVoiceBinding } from "@/projects/assets/episode-design/design-media-voice";
import { emptyEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import type { WorkspaceSnapshot } from "@/projects/workspace-sync/types";

const EPISODE = {
  id: "ep_1",
  episodeNumber: 1,
  title: "第一集",
  content: "角色江辰走上台。",
};

const state = vi.hoisted(() => ({
  store: null as ProjectEpisodeAssetDesignStore | null,
  remoteRevision: 1,
  conflictsRemaining: 0,
  concurrentBindOnConflict: false,
  snapshot: null as WorkspaceSnapshot | null,
  bindOnConflict: null as
    | ((
        store: ProjectEpisodeAssetDesignStore,
      ) => ProjectEpisodeAssetDesignStore)
    | null,
}));

vi.mock("@/projects/workspace-sync/ensure-workspace-initialized", () => ({
  ensureWorkspaceInitialized: vi.fn(async () => ({ ok: true, revision: 1 })),
}));

vi.mock("@/projects/workspace-sync/store", () => ({
  loadWorkspaceSnapshot: vi.fn(async () => state.snapshot),
  loadWorkspaceLocalEpisodeDesigns: vi.fn(async () => {
    return (
      state.store ?? {
        projectId: "project_voice_ws",
        records: [],
        updatedAt: "2026-08-12T00:00:00.000Z",
      }
    );
  }),
  loadWorkspaceLocalEpisodeDesignsDocument: vi.fn(async () => ({
    value:
      state.store ?? {
        projectId: "project_voice_ws",
        records: [],
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    remoteRevision: state.remoteRevision,
  })),
  saveWorkspaceLocalEpisodeDesigns: vi.fn(
    async (
      next: ProjectEpisodeAssetDesignStore,
      options?: { expectedRemoteRevision?: number },
    ) => {
      if (state.conflictsRemaining > 0) {
        state.conflictsRemaining -= 1;
        if (state.concurrentBindOnConflict && state.store && state.bindOnConflict) {
          state.store = state.bindOnConflict(state.store);
        }
        state.remoteRevision += 1;
        throw new Error("REMOTE_WORKSPACE_REQUEST_FAILED:409");
      }
      if (options?.expectedRemoteRevision !== state.remoteRevision) {
        throw new Error("REMOTE_WORKSPACE_REQUEST_FAILED:409");
      }
      state.store = next;
      state.remoteRevision += 1;
      return next;
    },
  ),
  loadWorkspaceLocalAssets: vi.fn(async () => ({
    projectId: "project_voice_ws",
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  })),
}));

import { saveWorkspaceEpisodeAssetDesignItems } from "@/projects/workspace-sync/workspace-episode-design-api";

function fingerprint() {
  return getScriptEpisodeContentFingerprint({
    episodeNumber: EPISODE.episodeNumber,
    title: EPISODE.title,
    content: EPISODE.content,
  });
}

function buildSnapshot(): WorkspaceSnapshot {
  return {
    projectId: "project_voice_ws",
    upstreamRevision: 1,
    syncedAt: "2026-08-12T00:00:00.000Z",
    sourceFingerprint: "fp",
    episodes: [EPISODE],
    assets: {
      projectId: "project_voice_ws",
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
    episodeAssetDesigns: emptyEpisodeAssetDesignStore("project_voice_ws"),
    syncStatus: "ok",
    syncError: null,
  };
}

function boundCharacterItem(): EpisodeAssetDesignItem & {
  assetType: "character";
} {
  return withDesignMediaVoiceBinding(
    {
      id: "item_1",
      name: "江辰",
      assetType: "character",
      resolution: "create_new",
      libraryAssetId: null,
      source: "ai",
      note: "旧备注",
      draft: {
        description: "描述",
        appearance: "",
        clothing: "",
        role: "",
        age: "",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "",
        evidence: "",
      },
      generatedMedia: {
        currentId: "gen_a",
        historyIds: ["gen_a"],
        history: [
          {
            mediaId: "gen_a",
            prompt: "a",
            generatedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
      },
    },
    "gen_a",
    {
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    },
  ) as EpisodeAssetDesignItem & { assetType: "character" };
}

function staleClientItem(
  patches: Partial<EpisodeAssetDesignItem> = {},
): EpisodeAssetDesignItem {
  const bound = boundCharacterItem();
  return {
    ...bound,
    note: "新备注",
    draft: {
      ...bound.draft,
      voiceId: null,
      voiceName: null,
      voiceBound: false,
    },
    generatedMedia: {
      ...bound.generatedMedia!,
      history: [
        {
          mediaId: "gen_a",
          prompt: "a",
          generatedAt: "2026-08-01T00:00:00.000Z",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
        },
      ],
    },
    ...patches,
  } as EpisodeAssetDesignItem;
}

function seedBoundRecord(revision = 1): EpisodeAssetDesignRecord {
  const item = boundCharacterItem();
  return {
    episodeId: EPISODE.id,
    episodeNumber: EPISODE.episodeNumber,
    status: "review",
    revision,
    contentFingerprint: fingerprint(),
    generationId: null,
    items: [item],
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function seedStore(record: EpisodeAssetDesignRecord) {
  state.store = {
    projectId: "project_voice_ws",
    records: [record],
    updatedAt: record.updatedAt,
  };
}

function assertVoiceKept(item: EpisodeAssetDesignItem | undefined) {
  expect(item?.assetType).toBe("character");
  if (!item || item.assetType !== "character") return;
  expect(item.draft.voiceId).toBe("voice_1");
  expect(item.draft.voiceBound).toBe(true);
  const history = item.generatedMedia?.history?.find(
    (entry) => entry.mediaId === "gen_a",
  );
  expect(history?.voiceId).toBe("voice_1");
  expect(history?.voiceBound).toBe(true);
}

describe("saveWorkspaceEpisodeAssetDesignItems voice preserve", () => {
  beforeEach(() => {
    state.store = null;
    state.remoteRevision = 1;
    state.conflictsRemaining = 0;
    state.concurrentBindOnConflict = false;
    state.bindOnConflict = null;
    state.snapshot = buildSnapshot();
  });

  it("note save cannot clear a bound media voice", async () => {
    seedStore(seedBoundRecord(1));
    const result = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: "project_voice_ws",
      episodeId: EPISODE.id,
      expectedRevision: 1,
      fingerprint: fingerprint(),
      items: [staleClientItem({ note: "新备注" })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.record.items[0];
    expect(item?.note).toBe("新备注");
    assertVoiceKept(item);
  });

  it("prompt edit cannot clear a bound media voice", async () => {
    seedStore(seedBoundRecord(1));
    const client = staleClientItem({
      designPrompt: {
        status: "ready",
        text: "新提示词",
        generationId: null,
        sourceFingerprint: null,
        generatedAt: "2026-08-12T01:00:00.000Z",
        updatedAt: "2026-08-12T01:00:00.000Z",
        errorMessage: null,
        history: [],
      },
    });
    const result = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: "project_voice_ws",
      episodeId: EPISODE.id,
      expectedRevision: 1,
      fingerprint: fingerprint(),
      items: [client],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.items[0]?.designPrompt?.text).toBe("新提示词");
    assertVoiceKept(result.record.items[0]);
  });

  it("adding a new image history entry cannot clear an older bound image", async () => {
    seedStore(seedBoundRecord(1));
    const client = staleClientItem({
      generatedMedia: {
        currentId: "gen_b",
        historyIds: ["gen_a", "gen_b"],
        history: [
          {
            mediaId: "gen_a",
            prompt: "a",
            generatedAt: "2026-08-01T00:00:00.000Z",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
          },
          {
            mediaId: "gen_b",
            prompt: "b",
            generatedAt: "2026-08-12T02:00:00.000Z",
          },
        ],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
      },
      draft: {
        description: "描述",
        appearance: "",
        clothing: "",
        role: "",
        age: "",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "",
        evidence: "",
      },
    });
    const result = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: "project_voice_ws",
      episodeId: EPISODE.id,
      expectedRevision: 1,
      fingerprint: fingerprint(),
      items: [client],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.record.items[0];
    expect(item?.generatedMedia?.historyIds).toContain("gen_b");
    const genA = item?.generatedMedia?.history?.find(
      (entry) => entry.mediaId === "gen_a",
    );
    expect(genA?.voiceId).toBe("voice_1");
    expect(genA?.voiceBound).toBe(true);
  });

  it("allows a new client binding with voiceBound:true to replace the old one", async () => {
    seedStore(seedBoundRecord(1));
    const replacement = withDesignMediaVoiceBinding(
      staleClientItem() as EpisodeAssetDesignItem & { assetType: "character" },
      "gen_a",
      {
        voiceId: "voice_2",
        voiceName: "新音色",
        voiceBound: true,
      },
    );
    const result = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: "project_voice_ws",
      episodeId: EPISODE.id,
      expectedRevision: 1,
      fingerprint: fingerprint(),
      items: [replacement],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.record.items[0];
    expect(item?.assetType).toBe("character");
    if (!item || item.assetType !== "character") return;
    expect(item.draft.voiceId).toBe("voice_2");
    expect(item.draft.voiceBound).toBe(true);
    expect(
      item.generatedMedia?.history?.find((entry) => entry.mediaId === "gen_a")
        ?.voiceId,
    ).toBe("voice_2");
  });

  it("rebases on remote CAS conflict and still keeps the latest binding", async () => {
    const unbound = staleClientItem({ note: "冲突前备注" });
    if (unbound.assetType === "character") {
      unbound.draft = {
        ...unbound.draft,
        voiceId: null,
        voiceName: null,
        voiceBound: false,
      };
    }
    seedStore({
      ...seedBoundRecord(1),
      items: [
        {
          ...unbound,
          note: "旧备注",
          generatedMedia: {
            currentId: "gen_a",
            historyIds: ["gen_a"],
            history: [
              {
                mediaId: "gen_a",
                prompt: "a",
                generatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            previewKind: "image",
          },
        },
      ],
    });
    state.conflictsRemaining = 1;
    state.concurrentBindOnConflict = true;
    state.bindOnConflict = (store) => {
      const record = store.records[0];
      const item = record?.items[0];
      if (!record || !item || item.assetType !== "character") return store;
      const rebound = withDesignMediaVoiceBinding(item, "gen_a", {
        voiceId: "voice_1",
        voiceName: "测试音色",
        voiceBound: true,
      });
      return {
        ...store,
        records: [
          {
            ...record,
            items: [rebound],
            revision: record.revision + 1,
            updatedAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    };

    const result = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: "project_voice_ws",
      episodeId: EPISODE.id,
      expectedRevision: 1,
      fingerprint: fingerprint(),
      items: [{ ...unbound, note: "新备注" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.items[0]?.note).toBe("新备注");
    assertVoiceKept(result.record.items[0]);
    expect(result.record.revision).toBeGreaterThan(1);
  });
});
