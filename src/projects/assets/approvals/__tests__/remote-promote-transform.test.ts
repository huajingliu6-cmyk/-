import { describe, expect, it } from 'vitest';

import { promoteApprovalItemDocuments } from '@/projects/assets/approvals/remote-promote-transform';

describe('remote approval promote transform', () => {
  it('creates a library asset and updates management and workspace designs', () => {
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
    const emptyAssets = {
      projectId: 'project_1',
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    };
    const designStore = {
      projectId: 'project_1',
      revision: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
      records: [
        {
          episodeId: 'episode_1',
          episodeNumber: 1,
          status: 'review' as const,
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

    const result = promoteApprovalItemDocuments({
      projectId: 'project_1',
      episodeId: 'episode_1',
      episodeNumber: 1,
      submissionId: 'submission_1',
      item: {
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
      workspaceItem,
      submittedByUserId: 'engineer_1',
      submittedAt: '2026-08-01T00:00:00.000Z',
      approvedByUserId: 'owner_1',
      approvedAt: '2026-08-01T01:00:00.000Z',
      managementAssets: emptyAssets,
      managementDesigns: designStore,
      workspaceAssets: null,
      workspaceDesigns: designStore,
    });

    expect(result.created).toBe(true);
    expect(result.managementAssets.scenes[0]).toMatchObject({
      id: result.assetId,
      imageFileName: 'media_1',
      primaryMediaId: 'media_1',
    });
    expect(result.managementDesigns.records[0]?.items[0]).toMatchObject({
      libraryAssetId: result.assetId,
      resolution: 'create_new',
      generatedMedia: { approvedIds: ['media_1'] },
    });
    expect(result.workspaceDesigns.records[0]?.items[0]).toMatchObject({
      libraryAssetId: result.assetId,
    });
  });

  it('reuses an existing asset linked to the same design item', () => {
    const workspaceItem = {
      id: 'design_1',
      assetType: 'prop' as const,
      name: 'Key',
      resolution: 'link_existing' as const,
      libraryAssetId: 'asset_1',
      source: 'manual' as const,
      draft: {
        description: 'key',
        propType: 'key',
        usage: 'open door',
        usageInEpisode: 'ending',
        evidence: 'script',
      },
    };
    const assets = {
      projectId: 'project_1',
      characters: [],
      scenes: [],
      props: [
        {
          id: 'asset_1',
          projectId: 'project_1',
          name: 'Key',
          propType: 'key',
          usage: 'open door',
          description: 'key',
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: 'draft' as const,
        },
      ],
      audios: [],
    };
    const designs = {
      projectId: 'project_1',
      revision: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
      records: [],
    };

    const result = promoteApprovalItemDocuments({
      projectId: 'project_1',
      episodeId: 'episode_1',
      episodeNumber: 1,
      submissionId: 'submission_1',
      item: {
        id: 'item_1',
        submissionId: 'submission_1',
        category: 'prop',
        assetDesignItemId: 'design_1',
        assetNameSnapshot: 'Key',
        generatedMediaId: 'media_1',
        generatedAtSnapshot: '2026-08-01T00:00:00.000Z',
        storageKey: 'media_1',
        promptSnapshot: null,
        status: 'pending',
        approvedByUserId: null,
        approvedAt: null,
        rejectedByUserId: null,
        rejectedAt: null,
        promotedAssetId: null,
      },
      workspaceItem,
      submittedByUserId: 'engineer_1',
      submittedAt: '2026-08-01T00:00:00.000Z',
      approvedByUserId: 'owner_1',
      approvedAt: '2026-08-01T01:00:00.000Z',
      managementAssets: assets,
      managementDesigns: designs,
      workspaceAssets: assets,
      workspaceDesigns: designs,
    });

    expect(result).toMatchObject({ assetId: 'asset_1', created: false });
    expect(result.managementAssets.props[0]).toMatchObject({
      primaryMediaId: 'media_1',
      approvedMediaIds: ['media_1'],
      status: 'completed',
    });
  });
});
