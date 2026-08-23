import { mergeAssetBundlesPreferLocalKeepUpstream } from '@/projects/assets/approvals/merge-workspace-assets';
import {
  applyMediaToExistingAsset,
  createAssetFromDesignItem,
  ensureDesignRecordHasItem,
  findLinkedAsset,
  resolveVideoRefSafetyFromDesignMedia,
  upsertAssetInBundle,
} from '@/projects/assets/approvals/promote';
import type { AssetApprovalItem } from '@/projects/assets/approvals/types';
import {
  mergeGeneratedMediaState,
  mergeMediaIdLists,
} from '@/projects/assets/episode-design/generated-media-history';
import { upsertEpisodeRecord } from '@/projects/assets/episode-design/store';
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from '@/projects/assets/episode-design/types';
import type {
  AssetApprovalProvenance,
  ProjectAssetBundle,
} from '@/projects/assets/types';
import { isSd2CertifiedForVideoRef } from '@/video-generation/sd2-cert-safety';

function updateApprovedDesignItem(input: {
  item: EpisodeAssetDesignItem;
  targetItemId: string;
  assetId: string;
  mediaId: string;
  prompt: string;
  generatedAt: string;
}) {
  if (input.item.id !== input.targetItemId) return input.item;
  const generatedMedia = mergeGeneratedMediaState(input.item.generatedMedia, {
    currentId: input.mediaId,
    historyIds: [input.mediaId],
    history: [
      {
        mediaId: input.mediaId,
        prompt: input.prompt,
        generatedAt: input.generatedAt,
      },
    ],
    status: 'completed',
    promptFingerprint: null,
    errorMessage: null,
    mimeType: 'image/png',
    previewKind: 'image',
    approvedIds: mergeMediaIdLists(
      input.item.generatedMedia?.approvedIds,
      [input.mediaId],
    ),
  });
  const next = {
    ...input.item,
    libraryAssetId: input.assetId,
    resolution:
      input.item.resolution === 'pending'
        ? ('create_new' as const)
        : input.item.resolution,
    generatedMedia,
  };
  return next.assetType === 'character'
    ? {
        ...next,
        draft: {
          ...next.draft,
          voiceBound: next.draft.voiceBound || Boolean(next.draft.voiceId),
        },
      }
    : next;
}

export type PromoteApprovalItemDocumentsResult =
  | {
      ok: true;
      assetId: string;
      created: boolean;
      managementAssets: ProjectAssetBundle;
      managementDesigns: ProjectEpisodeAssetDesignStore;
      workspaceAssets: ProjectAssetBundle;
      workspaceDesigns: ProjectEpisodeAssetDesignStore;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export function promoteApprovalItemDocuments(input: {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  submissionId: string;
  item: AssetApprovalItem;
  workspaceItem: EpisodeAssetDesignItem;
  submittedByUserId: string;
  submittedAt: string;
  approvedByUserId: string;
  approvedAt: string;
  managementAssets: ProjectAssetBundle;
  managementDesigns: ProjectEpisodeAssetDesignStore;
  workspaceAssets: ProjectAssetBundle | null;
  workspaceDesigns: ProjectEpisodeAssetDesignStore;
}): PromoteApprovalItemDocumentsResult {
  const mediaId = input.item.generatedMediaId;
  if (!mediaId?.trim()) {
    return {
      ok: false,
      code: 'GENERATED_MEDIA_INVALID',
      message: '入库缺少有效图片 mediaId',
    };
  }

  const videoRefSafety = resolveVideoRefSafetyFromDesignMedia(
    input.workspaceItem,
    mediaId,
  );
  if (
    input.item.category === 'character' &&
    !isSd2CertifiedForVideoRef(videoRefSafety)
  ) {
    return {
      ok: false,
      code: 'VIDEO_REF_REQUIRED',
      message: `角色「${input.item.assetNameSnapshot}」的入库图尚未通过 SD 真人素材认证，无法写入资产库。请先完成人物校验。`,
    };
  }

  const provenance: AssetApprovalProvenance = {
    source: 'workspace_approval',
    approvalSubmissionId: input.submissionId,
    approvalItemId: input.item.id,
    submittedByUserId: input.submittedByUserId,
    submittedAt: input.submittedAt,
    approvedByUserId: input.approvedByUserId,
    approvedAt: input.approvedAt,
    generatedMediaId: mediaId,
    assetDesignItemId: input.item.assetDesignItemId,
    episodeId: input.episodeId,
  };
  const linked = findLinkedAsset(
    input.managementAssets,
    input.item.category,
    input.item.assetDesignItemId,
    input.workspaceItem.libraryAssetId,
  );
  let managementAssets = input.managementAssets;
  let assetId: string;
  let created = false;
  if (linked) {
    assetId = linked.id;
    const updated = applyMediaToExistingAsset(
      linked,
      mediaId,
      provenance,
      videoRefSafety,
      input.workspaceItem,
    );
    managementAssets = upsertAssetInBundle(
      managementAssets,
      input.item.category,
      updated,
    );
  } else {
    const asset = createAssetFromDesignItem(
      input.projectId,
      input.workspaceItem,
      mediaId,
      provenance,
      videoRefSafety,
    );
    assetId = asset.id;
    created = true;
    managementAssets = upsertAssetInBundle(
      managementAssets,
      input.item.category,
      asset,
    );
  }

  const existingManagementRecord = input.managementDesigns.records.find(
    (record) => record.episodeId === input.episodeId,
  );
  const managementRecord = ensureDesignRecordHasItem(
    existingManagementRecord,
    input.workspaceItem,
    input.episodeId,
    input.episodeNumber,
  );
  const nextManagementRecord: EpisodeAssetDesignRecord = {
    ...managementRecord,
    items: managementRecord.items.map((item) =>
      updateApprovedDesignItem({
        item,
        targetItemId: input.item.assetDesignItemId,
        assetId,
        mediaId,
        prompt: input.item.promptSnapshot ?? '',
        generatedAt:
          input.item.generatedAtSnapshot || input.approvedAt,
      }),
    ),
    status:
      managementRecord.status === 'not_started' ||
      managementRecord.status === 'failed'
        ? 'review'
        : managementRecord.status,
    updatedAt: input.approvedAt,
  };
  const managementDesigns = upsertEpisodeRecord(
    input.managementDesigns,
    nextManagementRecord,
  );

  const workspaceAssets = input.workspaceAssets
    ? mergeAssetBundlesPreferLocalKeepUpstream(
        input.workspaceAssets,
        managementAssets,
      )
    : managementAssets;
  const workspaceRecord = input.workspaceDesigns.records.find(
    (record) => record.episodeId === input.episodeId,
  );
  const workspaceDesigns = workspaceRecord
    ? {
        ...input.workspaceDesigns,
        records: input.workspaceDesigns.records.map((record) =>
          record.episodeId === input.episodeId
            ? {
                ...record,
                items: record.items.map((item) =>
                  updateApprovedDesignItem({
                    item,
                    targetItemId: input.item.assetDesignItemId,
                    assetId,
                    mediaId,
                    prompt: input.item.promptSnapshot ?? '',
                    generatedAt:
                      input.item.generatedAtSnapshot || input.approvedAt,
                  }),
                ),
                updatedAt: input.approvedAt,
              }
            : record,
        ),
      }
    : input.workspaceDesigns;

  return {
    ok: true,
    assetId,
    created,
    managementAssets,
    managementDesigns,
    workspaceAssets,
    workspaceDesigns,
  };
}
