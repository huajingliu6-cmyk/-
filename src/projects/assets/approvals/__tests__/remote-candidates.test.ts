import { describe, expect, it, vi } from 'vitest';

const remoteImage = vi.hoisted(() => vi.fn());

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
}));
vi.mock('@/projects/assets/remote-asset-blob-store', () => ({
  getRemoteAssetImage: remoteImage,
}));
vi.mock('@/projects/workspace-sync/workspace-episode-design-api', () => ({
  getWorkspaceEpisodeAssetDesignDetail: vi.fn(async () => ({
    ok: true,
    record: {
      items: [
        {
          id: 'design_1',
          assetType: 'character',
          name: '林清',
          generatedMedia: {
            currentId: 'gen_1',
            historyIds: ['gen_1'],
            history: [
              {
                mediaId: 'gen_1',
                prompt: '角色提示词',
                generatedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            status: 'completed',
          },
        },
      ],
    },
  })),
  getEffectiveWorkspaceAssetBundle: vi.fn(async () => ({
    projectId: 'project_1',
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  })),
}));
vi.mock('@/projects/assets/approvals/store', () => ({
  loadAssetApprovalsFile: vi.fn(async () => ({
    version: 1,
    revision: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    submissions: [],
  })),
  listOpenMediaIds: () => new Set<string>(),
  listApprovedMediaIds: () => new Set<string>(),
}));
vi.mock('@/projects/assets/asset-bundle-store', () => ({
  loadAssetBundleDraft: vi.fn(async () => null),
}));

import { listApprovalCandidates } from '@/projects/assets/approvals/candidates';

describe('remote approval candidates', () => {
  it('checks media existence through the remote blob store', async () => {
    remoteImage.mockResolvedValue({
      body: Buffer.from([1]),
      contentType: 'image/png',
      etag: null,
    });
    const result = await listApprovalCandidates({
      projectId: 'project_1',
      episodeId: 'episode_1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      generatedMediaId: 'gen_1',
      status: 'submittable',
    });
    expect(remoteImage).toHaveBeenCalledWith('project_1', 'gen_1');
  });

  it('omits media missing from the remote blob store', async () => {
    remoteImage.mockResolvedValue(null);
    const result = await listApprovalCandidates({
      projectId: 'project_1',
      episodeId: 'episode_1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidates).toEqual([]);
  });
});
