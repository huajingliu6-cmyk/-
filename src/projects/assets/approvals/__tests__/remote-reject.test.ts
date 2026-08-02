import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredDocument = { revision: number; value: unknown };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());
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
  }),  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
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
        value.notifications.push(notification('ntf_concurrent', 'other'));
        documents.set(identity, {
          revision: (current?.revision ?? 0) + 1,
          value,
        });
        throw new Error('REVISION_CONFLICT');
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

vi.mock('@/projects/workspace-sync/workspace-episode-design-api', () => ({
  getWorkspaceEpisodeAssetDesignDetail: vi.fn(async () => ({
    ok: true,
    record: { episodeNumber: 2 },
  })),
}));

vi.mock("@/projects/assets/remote-transaction-client", () => ({
  runProjectAssetTransaction: atomicWrites,
}));
import { rejectRemoteAssetApprovalItems } from '@/projects/assets/approvals/remote-reject';

function notification(id: string, submissionId: string) {
  return {
    id,
    recipientUserId: 'engineer_1',
    type: 'asset_approval_rejected',
    projectId: 'project_1',
    episodeId: 'episode_1',
    submissionId,
    submitterUserId: 'engineer_1',
    title: id,
    summary: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    readAt: null,
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
          items: ['item_1', 'item_2'].map((id) => ({
            id,
            submissionId: 'submission_1',
            category: 'scene',
            assetDesignItemId: `design_${id}`,
            assetNameSnapshot: id,
            generatedMediaId: `media_${id}`,
            generatedAtSnapshot: '2026-08-01T00:00:00.000Z',
            storageKey: `media_${id}`,
            promptSnapshot: null,
            status: 'pending',
            approvedByUserId: null,
            approvedAt: null,
            rejectedByUserId: null,
            rejectedAt: null,
            promotedAssetId: null,
          })),
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
}

function reject(itemIds: string[]) {
  return rejectRemoteAssetApprovalItems({
    projectId: 'project_1',
    submissionId: 'submission_1',
    itemIds,
    rejectorUserId: 'owner_1',
  });
}

describe('remote asset approval reject', () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
    atomicWrites.mockClear();
    seed();
  });

  it('atomically rejects selected items and notifies the submitter', async () => {
    const result = await reject(['item_1']);

    expect(result).toMatchObject({
      ok: true,
      rejectedCount: 1,
      pendingCount: 1,
    });
    expect(atomicWrites.mock.calls[0]?.[0].writes).toHaveLength(2);
    const ownerNotifications = documents.get('notifications/owner_1')?.value as {
      notifications: Array<{ readAt: string | null }>;
    };
    expect(ownerNotifications.notifications[0]?.readAt).toBeNull();
  });

  it('marks the owner submission notification read when fully decided', async () => {
    const result = await reject(['item_1', 'item_2']);

    expect(result).toMatchObject({
      ok: true,
      rejectedCount: 2,
      pendingCount: 0,
    });
    expect(atomicWrites.mock.calls[0]?.[0].writes).toHaveLength(3);
    const ownerNotifications = documents.get('notifications/owner_1')?.value as {
      notifications: Array<{ readAt: string | null }>;
    };
    expect(ownerNotifications.notifications[0]?.readAt).toBeTruthy();
  });

  it('reloads after conflict and preserves concurrent submitter notifications', async () => {
    state.conflictsRemaining = 1;

    await reject(['item_1']);

    expect(atomicWrites).toHaveBeenCalledTimes(2);
    const submitterNotifications = documents.get(
      'notifications/engineer_1',
    )?.value as { notifications: Array<{ id: string }> };
    expect(submitterNotifications.notifications.map((item) => item.id)).toContain(
      'ntf_concurrent',
    );
    expect(submitterNotifications.notifications).toHaveLength(2);
  });

  it('is idempotent when selected items are already rejected', async () => {
    await reject(['item_1']);
    atomicWrites.mockClear();

    const result = await reject(['item_1']);

    expect(result).toMatchObject({ ok: true, rejectedCount: 1 });
    expect(atomicWrites).not.toHaveBeenCalled();
  });
});
