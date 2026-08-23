import { beforeEach, describe, expect, it, vi } from "vitest";

type RemoteState = {
  designRevision: number;
  assetRevision: number;
  designValue: {
    projectId: string;
    updatedAt: string;
    records: Array<Record<string, unknown>>;
  };
  assetValue: {
    projectId: string;
    characters: unknown[];
    scenes: unknown[];
    props: Array<Record<string, unknown>>;
    audios: unknown[];
    updatedAt: string;
  };
  conflictsRemaining: number;
};

const remote = vi.hoisted<RemoteState>(() => ({
  designRevision: 1,
  assetRevision: 1,
  designValue: {
    projectId: "project_1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    records: [],
  },
  assetValue: {
    projectId: "project_1",
    characters: [],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  conflictsRemaining: 0,
}));
const transaction = vi.hoisted(() => vi.fn());
const remoteDocuments = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === "REVISION_CONFLICT",
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const doc = remoteDocuments.get(`${namespace}/${key}`);
    return doc
      ? {
          namespace,
          key,
          revision: doc.revision,
          value: structuredClone(doc.value),
          updatedAt: new Date().toISOString(),
        }
      : null;
  }),
  putRemoteDocument: vi.fn(async (input: {
    namespace: string;
    key: string;
    expectedRevision?: number;
    value: unknown;
  }) => {
    const identity = `${input.namespace}/${input.key}`;
    const current = remoteDocuments.get(identity);
    const expected = input.expectedRevision ?? 0;
    if ((current?.revision ?? 0) !== expected) {
      throw new Error("REVISION_CONFLICT");
    }
    const revision = (current?.revision ?? 0) + 1;
    remoteDocuments.set(identity, {
      revision,
      value: structuredClone(input.value),
    });
    return {
      namespace: input.namespace,
      key: input.key,
      revision,
      value: structuredClone(input.value),
      updatedAt: new Date().toISOString(),
    };
  }),
  putRemoteDocumentsAtomic: transaction,
  isRemoteDataServiceError: () => false,
}));

vi.mock("@/projects/workspace-sync/workspace-episode-design-api", () => ({
  getWorkspaceEpisodeAssetDesignDetail: vi.fn(
    async (_projectId: string, episodeId: string) => {
      const record = remote.designValue.records.find(
        (candidate) => candidate.episodeId === episodeId,
      );
      return record
        ? {
            ok: true,
            episode: {
              id: episodeId,
              episodeNumber: 1,
              title: "第一集",
              content: "剧本正文",
            },
            record: structuredClone(record),
            currentFingerprint: "fingerprint_1",
            designStatus: "review",
          }
        : { ok: false, code: "EPISODE_NOT_FOUND", message: "剧集不存在" };
    },
  ),
  getEffectiveWorkspaceAssetBundle: vi.fn(async () =>
    structuredClone(remote.assetValue),
  ),
}));

vi.mock("@/projects/workspace-sync/store", () => ({
  loadWorkspaceLocalEpisodeDesigns: vi.fn(async () =>
    structuredClone(remote.designValue),
  ),
  loadWorkspaceLocalEpisodeDesignsDocument: vi.fn(async () => ({
    value: structuredClone(remote.designValue),
    remoteRevision: remote.designRevision,
  })),
}));

vi.mock("@/projects/workspace-sync/remote-store", () => ({
  loadWorkspaceAssetsRemoteDocument: vi.fn(async () => ({
    value: structuredClone(remote.assetValue),
    revision: remote.assetRevision,
  })),
  loadWorkspaceEpisodeDesignsRemoteDocument: vi.fn(async () => ({
    value: structuredClone(remote.designValue),
    revision: remote.designRevision,
  })),
  workspaceAssetsRemoteIdentity: (projectId: string) => ({
    namespace: "workspace-assets",
    key: projectId,
  }),
  workspaceEpisodeDesignsRemoteIdentity: (projectId: string) => ({
    namespace: "workspace-episode-asset-designs",
    key: projectId,
  }),
}));

vi.mock("@/projects/assets/remote-transaction-client", () => ({
  runProjectAssetTransaction: transaction,
}));

import { confirmWorkspaceEpisodeAssetDesign } from "@/projects/workspace-sync/workspace-confirm";

function propItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item_1",
    assetType: "prop",
    name: "雨伞",
    resolution: "create_new",
    source: "ai",
    draft: {
      description: "黑色雨伞",
      propType: "道具",
      usage: "雨中场景",
      usageInEpisode: "开场",
      evidence: "剧本",
    },
    ...overrides,
  };
}

function seed(withImage: boolean) {
  remote.designRevision = 1;
  remote.assetRevision = 1;
  remote.conflictsRemaining = 0;
  remote.designValue = {
    projectId: "project_1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    records: [
      {
        episodeId: "episode_1",
        episodeNumber: 1,
        status: "review",
        revision: 1,
        contentFingerprint: "fingerprint_1",
        generationId: null,
        items: [
          withImage
            ? propItem({
                generatedMedia: {
                  currentId: "gen_umbrella_1",
                  historyIds: ["gen_umbrella_1"],
                  history: [
                    {
                      mediaId: "gen_umbrella_1",
                      prompt: "雨伞",
                      generatedAt: "2026-08-01T00:00:00.000Z",
                      mimeType: "image/png",
                    },
                  ],
                  status: "completed",
                  promptFingerprint: null,
                  errorMessage: null,
                  mimeType: "image/png",
                  previewKind: "image",
                },
              })
            : propItem(),
        ],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  };
  remote.assetValue = {
    projectId: "project_1",
    characters: [],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  transaction.mockReset();
  remoteDocuments.clear();
  transaction.mockImplementation(
    async (input: {
      writes: Array<{
        namespace: string;
        key?: string;
        expectedRevision: number;
        value: unknown;
      }>;
    }) => {
      if (remote.conflictsRemaining > 0) {
        remote.conflictsRemaining -= 1;
        remote.assetRevision += 1;
        throw new Error("REVISION_CONFLICT");
      }
      const designWrite = input.writes.find(
        (write) => write.namespace === "workspace-episode-asset-designs",
      );
      const assetWrite = input.writes.find(
        (write) => write.namespace === "workspace-assets",
      );
      if (
        designWrite?.expectedRevision !== remote.designRevision ||
        assetWrite?.expectedRevision !== remote.assetRevision
      ) {
        throw new Error("REVISION_CONFLICT");
      }
      for (const write of input.writes) {
        if (
          write.namespace === "workspace-episode-asset-designs" ||
          write.namespace === "workspace-assets"
        ) {
          continue;
        }
        const identity = `${write.namespace}/${write.key ?? ""}`;
        const current = remoteDocuments.get(identity);
        if ((current?.revision ?? 0) !== write.expectedRevision) {
          throw new Error("REVISION_CONFLICT");
        }
      }
      for (const write of input.writes) {
        const identity = `${write.namespace}/${write.key ?? ""}`;
        const current = remoteDocuments.get(identity);
        remoteDocuments.set(identity, {
          revision: (current?.revision ?? 0) + 1,
          value: structuredClone(write.value),
        });
      }
      remote.designRevision += 1;
      remote.assetRevision += 1;
      remote.designValue = structuredClone(
        designWrite?.value,
      ) as RemoteState["designValue"];
      remote.assetValue = structuredClone(
        assetWrite?.value,
      ) as RemoteState["assetValue"];
    },
  );
}

describe("remote workspace asset confirmation", () => {
  beforeEach(() => seed(false));

  it("batch confirm without images creates draft library rows", async () => {
    const result = await confirmWorkspaceEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "collaborator_1",
      fingerprint: "fingerprint_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual([]);
    expect(result.counts.created).toBe(1);
    expect(remote.designValue.records[0]).toMatchObject({
      status: "confirmed",
      confirmedBy: "collaborator_1",
    });
    expect(remote.assetValue.props).toHaveLength(1);
    expect(remote.assetValue.props[0]).toMatchObject({
      name: "雨伞",
      status: "draft",
    });
  });

  it("batch confirm with generated image promotes and confirms", async () => {
    seed(true);
    const result = await confirmWorkspaceEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "collaborator_1",
      fingerprint: "fingerprint_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
    expect(remote.designValue.records[0]).toMatchObject({
      status: "confirmed",
      confirmedBy: "collaborator_1",
    });
    expect(remote.assetValue.props).toHaveLength(1);
    expect(remote.assetValue.props[0]).toMatchObject({
      name: "雨伞",
      imageFileName: "gen_umbrella_1",
    });
  });

  it("reloads both workspace documents after a revision conflict", async () => {
    seed(true);
    remote.conflictsRemaining = 1;

    const result = await confirmWorkspaceEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "collaborator_1",
      fingerprint: "fingerprint_1",
    });

    expect(result.ok).toBe(true);
    expect(transaction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(remote.assetValue.props).toHaveLength(1);
  });
});
