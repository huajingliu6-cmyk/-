import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspace = vi.hoisted(() => ({
  snapshot: null as null | Record<string, unknown>,
  localDesigns: { projectId: 'project_1', records: [], updatedAt: '' },
}));

vi.mock('@/projects/script/script-draft-store', () => ({
  loadScriptDraft: vi.fn(async () => ({
    episodes: [
      {
        id: 'episode_1',
        episodeNumber: 1,
        title: '第一集',
        content: '正文',
      },
    ],
  })),
}));
vi.mock('@/projects/assets/asset-bundle-store', () => ({
  loadAssetBundleDraft: vi.fn(async () => ({
    projectId: 'project_1',
    characters: [],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
  })),
}));
vi.mock('@/projects/assets/episode-design/store', () => ({
  loadEpisodeAssetDesignStore: vi.fn(async () => ({
    projectId: 'project_1',
    records: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
  })),
  upsertEpisodeRecord: vi.fn(),
}));
vi.mock('@/projects/workspace-sync/store', () => ({
  loadWorkspaceSnapshot: vi.fn(async () => workspace.snapshot),
  saveWorkspaceSnapshot: vi.fn(async (snapshot: Record<string, unknown>) => {
    workspace.snapshot = structuredClone(snapshot);
    return snapshot;
  }),
  loadWorkspaceLocalEpisodeDesigns: vi.fn(async () => workspace.localDesigns),
  saveWorkspaceLocalEpisodeDesigns: vi.fn(),
}));

import { syncManagementToWorkspace } from '@/projects/workspace-sync/sync-management-to-workspace';

describe('remote management to workspace synchronization', () => {
  beforeEach(() => {
    workspace.snapshot = null;
    workspace.localDesigns = {
      projectId: 'project_1',
      records: [],
      updatedAt: '',
    };
  });

  it('writes a real workspace snapshot instead of deferring remote mode', async () => {
    const result = await syncManagementToWorkspace('project_1');
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(workspace.snapshot).toMatchObject({
      projectId: 'project_1',
      upstreamRevision: 1,
      syncStatus: 'ok',
    });
  });
});
