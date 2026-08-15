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

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === "REVISION_CONFLICT",
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

function seed() {
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
          {
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
          },
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
  transaction.mockImplementation(
    async (input: {
      writes: Array<{
        namespace: string;
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
  beforeEach(seed);

  it("atomically creates a draft asset without generated media", async () => {
    const result = await confirmWorkspaceEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "collaborator_1",
      fingerprint: "fingerprint_1",
    });

    expect(result.ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(remote.designValue.records[0]).toMatchObject({
      status: "confirmed",
      confirmedBy: "collaborator_1",
    });
    expect(remote.assetValue.props).toHaveLength(1);
    expect(remote.assetValue.props[0]).toMatchObject({
      name: "雨伞",
      imageFileName: null,
      status: "draft",
    });
  });

  it("reloads both workspace documents after a revision conflict", async () => {
    remote.conflictsRemaining = 1;

    const result = await confirmWorkspaceEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "collaborator_1",
      fingerprint: "fingerprint_1",
    });

    expect(result.ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(remote.assetValue.props).toHaveLength(1);
  });
});
