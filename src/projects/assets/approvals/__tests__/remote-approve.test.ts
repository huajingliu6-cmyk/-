import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredDocument = { revision: number; value: unknown };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());
const blobs = vi.hoisted(() => new Set<string>());
const state = vi.hoisted(() => ({ conflictsRemaining: 0 }));
const atomicWrites = vi.hoisted(() => vi.fn());

vi.mock('@/persistence/remote-data-client', () => ({
  requestRemoteData: vi.fn(async (requestPath: string) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    let identity = "";
    if (url.pathname === "/v1/project-asset-data") {
      const namespace = {
        bundle: "asset-bundles",
        "episode-designs": "episode-asset-designs",
        approvals: "asset-approvals",
      }[url.searchParams.get("kind") ?? ""];
      identity = `${namespace}/${url.searchParams.get("projectId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        value: structuredClone(document?.value ?? null),
        revision: document?.revision ?? 0,
      });
    }
    if (url.pathname === "/v1/workspace-data") {
      const namespace = {
        snapshot: "workspace-snapshots",
        assets: "workspace-assets",
        "episode-designs": "workspace-episode-asset-designs",
      }[url.searchParams.get("kind") ?? ""];
      identity = `${namespace}/${url.searchParams.get("projectId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        value: structuredClone(document?.value ?? null),
        revision: document?.revision ?? 0,
      });
    }
    if (url.pathname === "/v1/notifications") {
      identity = `notifications/${url.searchParams.get("userId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        file: structuredClone(
          document?.value ?? { version: 1, notifications: [] },
        ),
        revision: document?.revision ?? 0,
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }),  isRemoteDataOnly: () => true,
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const document = documents.get(`${namespace}/${key}`);
    return document
      ? {
          namespace,
          key,
          revision: document.revision,
          value: structuredClone(document.value),
          updatedAt: new Date().toISOString(),
        }
      : null;
  }),
  putRemoteDocument: vi.fn(),
  putRemoteDocumentsAtomic: atomicWrites.mockImplementation(
    async (input: {
      writes: Array<{
        namespace: string;
        key: string;
        expectedRevision: number;
        value: unknown;
      }>;
      blobChecks?: string[];
    }) => {
      if (state.conflictsRemaining > 0) {
        state.conflictsRemaining -= 1;
        const identity = 'notifications/engineer_1';
        const current = documents.get(identity);
        const value = structuredClone(
          (current?.value ?? { version: 1, notifications: [] }) as {
            version: 1;
            notifications: unknown[];
          },
        );
        value.notifications.push({
          id: 'ntf_concurrent',
          recipientUserId: 'engineer_1',
          type: 'asset_approval_rejected',
          projectId: 'project_other',
          episodeId: 'episode_other',
          submissionId: 'submission_other',
          submitterUserId: 'engineer_1',
          title: 'concurrent',
          summary: 'concurrent',
          createdAt: '2026-08-01T00:00:00.000Z',
          readAt: null,
        });
        documents.set(identity, {
          revision: (current?.revision ?? 0) + 1,
          value,
        });
        throw new Error('REVISION_CONFLICT');
      }
      for (const storageKey of input.blobChecks ?? []) {
        if (!blobs.has(storageKey)) {
          throw new Error('REMOTE_BLOB_SOURCE_NOT_FOUND');
        }
      }
      for (const write of input.writes) {
        const current = documents.get(`${write.namespace}/${write.key}`);
        if (write.expectedRevision !== (current?.revision ?? 0)) {
          throw new Error('REVISION_CONFLICT');
        }
      }
      const result = input.writes.map((write) => {
        const identity = `${write.namespace}/${write.key}`;
        const current = documents.get(identity);
        const next = {
          revision: (current?.revision ?? 0) + 1,
          value: structuredClone(write.value),
        };
        documents.set(identity, next);
        return {
          namespace: write.namespace,
          key: write.key,
          revision: next.revision,
          value: structuredClone(next.value),
          updatedAt: new Date().toISOString(),
        };
      });
      return { documents: result };
    },
  ),
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === 'REVISION_CONFLICT',
}));

vi.mock("@/projects/assets/remote-transaction-client", () => ({
  runProjectAssetTransaction: atomicWrites,
}));
import { approveRemoteAssetApprovalItems } from '@/projects/assets/approvals/remote-approve';

const workspaceItem = {
  id: 'design_1',
  assetType: 'scene' as const,
  name: 'Night street',
  resolution: 'pending' as const,
  source: 'manual' as const,
  draft: {
    description: 'street',
    timeOfDay: 'night',
    location: 'city',
    style: 'realistic',
    usageInEpisode: 'opening',
    evidence: 'script',
  },
  generatedMedia: {
    currentId: 'media_1',
    historyIds: ['media_1'],
    status: 'completed' as const,
    promptFingerprint: null,
    errorMessage: null,
  },
};

function designStore() {
  return {
    projectId: 'project_1',
    updatedAt: '2026-08-01T00:00:00.000Z',
    records: [
      {
        episodeId: 'episode_1',
        episodeNumber: 1,
        status: 'review',
        revision: 1,
        contentFingerprint: null,
        generationId: null,
        items: [workspaceItem],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  };
}

function emptyAssets() {
  return {
    projectId: 'project_1',
    characters: [],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function seed() {
  documents.set('asset-approvals/project_1', {
    revision: 1,
    value: {
      version: 1,
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      submissions: [
        {
          id: 'submission_1',
          projectId: 'project_1',
          episodeId: 'episode_1',
          submittedByUserId: 'engineer_1',
          approverUserId: 'owner_1',
          status: 'pending',
          items: [
            {
              id: 'item_1',
              submissionId: 'submission_1',
              category: 'scene',
              assetDesignItemId: 'design_1',
              assetNameSnapshot: 'Night street',
              generatedMediaId: 'media_1',
              generatedAtSnapshot: '2026-08-01T00:00:00.000Z',
              storageKey: 'media_1',
              promptSnapshot: 'night street',
              status: 'pending',
              approvedByUserId: null,
              approvedAt: null,
              rejectedByUserId: null,
              rejectedAt: null,
              promotedAssetId: null,
            },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          submittedAt: '2026-08-01T00:00:00.000Z',
          completedAt: null,
          revision: 1,
          idempotencyKey: 'submit_1',
        },
      ],
    },
  });
  documents.set('asset-bundles/project_1', { revision: 1, value: emptyAssets() });
  documents.set('episode-asset-designs/project_1', {
    revision: 1,
    value: designStore(),
  });
  documents.set('workspace-snapshots/project_1', {
    revision: 1,
    value: {
      projectId: 'project_1',
      upstreamRevision: 1,
      syncedAt: '2026-08-01T00:00:00.000Z',
      sourceFingerprint: null,
      episodes: [
        { id: 'episode_1', episodeNumber: 1, title: 'Episode', content: 'Story' },
      ],
      assets: emptyAssets(),
      episodeAssetDesigns: designStore(),
      syncStatus: 'ok',
      syncError: null,
    },
  });
  documents.set('workspace-assets/project_1', {
    revision: 1,
    value: emptyAssets(),
  });
  documents.set('workspace-episode-asset-designs/project_1', {
    revision: 1,
    value: designStore(),
  });
  documents.set('notifications/owner_1', {
    revision: 1,
    value: {
      version: 1,
      notifications: [
        {
          id: 'ntf_submitted',
          recipientUserId: 'owner_1',
          type: 'asset_approval_submitted',
          projectId: 'project_1',
          episodeId: 'episode_1',
          submissionId: 'submission_1',
          submitterUserId: 'engineer_1',
          title: 'submitted',
          summary: 'submitted',
          createdAt: '2026-08-01T00:00:00.000Z',
          readAt: null,
        },
      ],
    },
  });
  blobs.add('projects/project_1/asset-images/media_1');
}

function approve() {
  return approveRemoteAssetApprovalItems({
    projectId: 'project_1',
    submissionId: 'submission_1',
    itemIds: ['item_1'],
    approverUserId: 'owner_1',
  });
}

describe('remote asset approval approve', () => {
  beforeEach(() => {
    documents.clear();
    blobs.clear();
    state.conflictsRemaining = 0;
    atomicWrites.mockClear();
    seed();
  });

  it('atomically promotes media across all documents and notifications', async () => {
    const result = await approve();

    expect(result).toMatchObject({
      ok: true,
      approvedCount: 1,
      pendingCount: 0,
    });
    const transaction = atomicWrites.mock.calls[0]?.[0];
    expect(transaction.writes).toHaveLength(8);
    expect(transaction.blobChecks).toEqual([
      'projects/project_1/asset-images/media_1',
    ]);
    const assets = documents.get('asset-bundles/project_1')?.value as {
      scenes: Array<{ id: string; primaryMediaId: string }>;
    };
    expect(assets.scenes[0]?.primaryMediaId).toBe('media_1');
    const ownerNotifications = documents.get('notifications/owner_1')?.value as {
      notifications: Array<{ readAt: string | null }>;
    };
    expect(ownerNotifications.notifications[0]?.readAt).toBeTruthy();
  });

  it('returns a stable validation error without writes when media is missing', async () => {
    blobs.clear();

    const result = await approve();

    expect(result).toMatchObject({
      ok: false,
      code: 'GENERATED_MEDIA_INVALID',
      status: 422,
    });
    expect(documents.get('asset-bundles/project_1')?.value).toEqual(emptyAssets());
  });

  it('reloads all documents after conflict and preserves concurrent notifications', async () => {
    state.conflictsRemaining = 1;

    const result = await approve();

    expect(result).toMatchObject({ ok: true });
    expect(atomicWrites).toHaveBeenCalledTimes(2);
    const notifications = documents.get('notifications/engineer_1')?.value as {
      notifications: Array<{ id: string }>;
    };
    expect(notifications.notifications.map((item) => item.id)).toContain(
      'ntf_concurrent',
    );
    expect(notifications.notifications).toHaveLength(2);
  });

  it('does not write or notify again when the item is already promoted', async () => {
    const first = await approve();
    atomicWrites.mockClear();

    const second = await approve();

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true, approvedCount: 1 });
    expect(atomicWrites).not.toHaveBeenCalled();
  });
});
