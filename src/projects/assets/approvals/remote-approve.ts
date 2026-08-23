import 'server-only';

import { randomUUID } from 'crypto';
import {
  loadRemoteNotificationsDocument,
  notificationsRemoteIdentity,
} from '@/notifications/remote-store';
import { normalizeNotificationsFile } from '@/notifications/store';
import type { AppNotification, NotificationsFile } from '@/notifications/types';
import { isRemoteRevisionConflict } from '@/persistence/remote-data-client';
import { runProjectAssetTransaction } from '@/projects/assets/remote-transaction-client';
import {
  assetApprovalsRemoteIdentity,
  loadAssetApprovalsRemoteDocument,
} from '@/projects/assets/approvals/remote-store';
import { promoteApprovalItemDocuments } from '@/projects/assets/approvals/remote-promote-transform';
import {
  computeSubmissionStatus,
  findSubmission,
  normalizeAssetApprovalsFile,
} from '@/projects/assets/approvals/store';
import type { ApproveAssetApprovalResult } from '@/projects/assets/approvals/approve';
import type { AssetApprovalSubmission } from '@/projects/assets/approvals/types';
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
} from '@/projects/assets/asset-bundle-store';
import {
  assetBundleRemoteIdentity,
  loadAssetBundleDraftRemoteDocument,
} from '@/projects/assets/remote-asset-bundle-store';
import { imageStorageKey } from '@/projects/assets/remote-asset-blob-store';
import {
  emptyEpisodeAssetDesignStore,
  normalizeEpisodeAssetDesignStore,
} from '@/projects/assets/episode-design/store';
import {
  episodeAssetDesignRemoteIdentity,
  loadEpisodeAssetDesignStoreRemoteDocument,
} from '@/projects/assets/episode-design/remote-store';
import type { ProjectEpisodeAssetDesignStore } from '@/projects/assets/episode-design/types';
import type { ProjectAssetBundle } from '@/projects/assets/types';
import {
  loadWorkspaceAssetsRemoteDocument,
  loadWorkspaceEpisodeDesignsRemoteDocument,
  loadWorkspaceSnapshotRemoteDocument,
  workspaceAssetsRemoteIdentity,
  workspaceEpisodeDesignsRemoteIdentity,
  workspaceSnapshotRemoteIdentity,
} from '@/projects/workspace-sync/remote-store';
import {
  normalizeWorkspaceSnapshot,
} from '@/projects/workspace-sync/store';
import { computeSourceFingerprint } from '@/projects/workspace-sync/sync-management-to-workspace';

type NotificationState = {
  document: Awaited<ReturnType<typeof loadRemoteNotificationsDocument>>;
  file: NotificationsFile;
};

function emptyAssets(projectId: string): ProjectAssetBundle {
  return {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
}

async function approveRemoteAttempt(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  approverUserId: string;
}): Promise<ApproveAssetApprovalResult> {
  const [
    approvalDocument,
    managementAssetDocument,
    managementDesignDocument,
    workspaceSnapshotDocument,
    workspaceAssetDocument,
    workspaceDesignDocument,
  ] = await Promise.all([
    loadAssetApprovalsRemoteDocument(input.projectId),
    loadAssetBundleDraftRemoteDocument(input.projectId),
    loadEpisodeAssetDesignStoreRemoteDocument(input.projectId),
    loadWorkspaceSnapshotRemoteDocument(input.projectId),
    loadWorkspaceAssetsRemoteDocument(input.projectId),
    loadWorkspaceEpisodeDesignsRemoteDocument(input.projectId),
  ]);

  const approvals = normalizeAssetApprovalsFile(approvalDocument?.value);
  const submission = findSubmission(approvals, input.submissionId);
  if (!submission || submission.projectId !== input.projectId) {
    return {
      ok: false,
      code: 'APPROVAL_SUBMISSION_NOT_FOUND',
      message: '审批单不存在',
      status: 404,
    };
  }
  const uniqueItemIds = [
    ...new Set(input.itemIds.map((itemId) => itemId.trim()).filter(Boolean)),
  ];
  if (uniqueItemIds.length === 0) {
    return {
      ok: false,
      code: 'INVALID_APPROVAL_SELECTION',
      message: '请至少选择一个待审批条目',
      status: 400,
    };
  }
  for (const itemId of uniqueItemIds) {
    if (!submission.items.some((item) => item.id === itemId)) {
      return {
        ok: false,
        code: 'INVALID_APPROVAL_SELECTION',
        message: `审批条目不存在：${itemId}`,
        status: 400,
      };
    }
  }

  const now = new Date().toISOString();
  let managementAssets =
    normalizeAssetBundleDraft(input.projectId, managementAssetDocument?.value) ??
    emptyAssets(input.projectId);
  let managementDesigns = managementDesignDocument
    ? normalizeEpisodeAssetDesignStore(
        input.projectId,
        managementDesignDocument.value,
      )
    : emptyEpisodeAssetDesignStore(input.projectId);
  const workspaceSnapshot = normalizeWorkspaceSnapshot(
    input.projectId,
    workspaceSnapshotDocument?.value,
  );
  let workspaceAssets: ProjectAssetBundle | null = normalizeAssetBundleDraft(
    input.projectId,
    workspaceAssetDocument?.value,
  );
  let workspaceDesigns: ProjectEpisodeAssetDesignStore =
    workspaceDesignDocument
      ? normalizeEpisodeAssetDesignStore(
          input.projectId,
          workspaceDesignDocument.value,
        )
      : emptyEpisodeAssetDesignStore(input.projectId);
  let nextItems = [...submission.items];
  const promoted: Array<{ itemId: string; assetId: string; created: boolean }> = [];
  const blobChecks: string[] = [];
  let newlyPromoted = 0;

  for (const itemId of uniqueItemIds) {
    const item = nextItems.find((candidate) => candidate.id === itemId)!;
    if (item.status === 'approved' && item.promotedAssetId) {
      promoted.push({
        itemId,
        assetId: item.promotedAssetId,
        created: false,
      });
      continue;
    }
    const workspaceRecord = workspaceDesigns.records.find(
      (record) => record.episodeId === submission.episodeId,
    );
    const snapshotRecord = workspaceSnapshot.episodeAssetDesigns.records.find(
      (record) => record.episodeId === submission.episodeId,
    );
    const workspaceItem = (workspaceRecord ?? snapshotRecord)?.items.find(
      (candidate) => candidate.id === item.assetDesignItemId,
    );
    if (!workspaceItem || workspaceItem.assetType !== item.category) {
      return {
        ok: false,
        code: 'ASSET_DESIGN_ITEM_NOT_FOUND',
        message: '资产设计项不存在或类型不匹配',
        status: 400,
      };
    }
    const transformed = promoteApprovalItemDocuments({
      projectId: input.projectId,
      episodeId: submission.episodeId,
      episodeNumber:
        (workspaceRecord ?? snapshotRecord)?.episodeNumber ?? 0,
      submissionId: submission.id,
      item,
      workspaceItem,
      submittedByUserId: submission.submittedByUserId,
      submittedAt: submission.submittedAt,
      approvedByUserId: input.approverUserId,
      approvedAt: now,
      managementAssets,
      managementDesigns,
      workspaceAssets,
      workspaceDesigns,
    });
    if (!transformed.ok) {
      return {
        ok: false,
        code: transformed.code,
        message: transformed.message,
        status: transformed.code === 'VIDEO_REF_REQUIRED' ? 422 : 400,
      };
    }
    managementAssets = transformed.managementAssets;
    managementDesigns = transformed.managementDesigns;
    workspaceAssets = transformed.workspaceAssets;
    workspaceDesigns = transformed.workspaceDesigns;
    nextItems = nextItems.map((candidate) =>
      candidate.id === itemId
        ? {
            ...candidate,
            status: 'approved' as const,
            approvedByUserId: input.approverUserId,
            approvedAt: now,
            promotedAssetId: transformed.assetId,
          }
        : candidate,
    );
    promoted.push({
      itemId,
      assetId: transformed.assetId,
      created: transformed.created,
    });
    newlyPromoted += 1;
    blobChecks.push(imageStorageKey(input.projectId, item.generatedMediaId));
  }

  if (newlyPromoted === 0) {
    const pendingCount = submission.items.filter((item) => item.status === 'pending')
      .length;
    return {
      ok: true,
      submission,
      approvedCount: submission.items.filter((item) => item.status === 'approved')
        .length,
      pendingCount,
      promoted,
    };
  }

  const status = computeSubmissionStatus(nextItems);
  const updatedSubmission: AssetApprovalSubmission = {
    ...submission,
    items: nextItems,
    status,
    updatedAt: now,
    completedAt: status === 'approved' ? now : submission.completedAt,
    revision: submission.revision + 1,
  };
  approvals.submissions = approvals.submissions.map((candidate) =>
    candidate.id === updatedSubmission.id ? updatedSubmission : candidate,
  );
  approvals.revision += 1;
  approvals.updatedAt = now;
  const managementAssetDraft = {
    ...sanitizeAssetBundleForPersist(managementAssets),
    updatedAt: now,
  };
  managementDesigns = { ...managementDesigns, updatedAt: now };
  const workspaceAssetDraft = workspaceAssets
    ? { ...sanitizeAssetBundleForPersist(workspaceAssets), updatedAt: now }
    : { ...sanitizeAssetBundleForPersist(managementAssetDraft), updatedAt: now };
  workspaceDesigns = { ...workspaceDesigns, updatedAt: now };
  const nextSnapshot = {
    ...workspaceSnapshot,
    upstreamRevision: workspaceSnapshot.upstreamRevision + 1,
    syncedAt: now,
    sourceFingerprint: computeSourceFingerprint({
      episodes: workspaceSnapshot.episodes,
      assetsUpdatedAt: now,
      designsUpdatedAt: now,
    }),
    assets: managementAssetDraft,
    episodeAssetDesigns: managementDesigns,
    syncStatus: 'ok' as const,
    syncError: null,
  };

  const pendingCount = updatedSubmission.items.filter(
    (item) => item.status === 'pending',
  ).length;
  const notificationUserIds = new Set([updatedSubmission.submittedByUserId]);
  if (pendingCount === 0) notificationUserIds.add(updatedSubmission.approverUserId);
  const notificationStates = new Map<string, NotificationState>();
  await Promise.all(
    [...notificationUserIds].map(async (userId) => {
      const document = await loadRemoteNotificationsDocument(userId);
      notificationStates.set(userId, {
        document,
        file: normalizeNotificationsFile(document?.value),
      });
    }),
  );
  const submitterState = notificationStates.get(
    updatedSubmission.submittedByUserId,
  )!;
  const approvedNotification: AppNotification = {
    id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    recipientUserId: updatedSubmission.submittedByUserId,
    type: 'asset_approval_approved',
    projectId: input.projectId,
    episodeId: updatedSubmission.episodeId,
    submissionId: updatedSubmission.id,
    submitterUserId: updatedSubmission.submittedByUserId,
    title: '素材审批已通过',
    summary: `有 ${newlyPromoted} 张素材已通过审批并入库。`,
    createdAt: now,
    readAt: null,
  };
  submitterState.file.notifications.push(approvedNotification);
  if (pendingCount === 0) {
    const approverState = notificationStates.get(updatedSubmission.approverUserId)!;
    approverState.file.notifications = approverState.file.notifications.map(
      (notification) =>
        notification.submissionId === updatedSubmission.id &&
        notification.type === 'asset_approval_submitted' &&
        !notification.readAt
          ? { ...notification, readAt: now }
          : notification,
    );
  }

  try {
    await runProjectAssetTransaction({
      writes: [
        {
          ...assetApprovalsRemoteIdentity(input.projectId),
          expectedRevision: approvalDocument?.revision ?? 0,
          value: approvals,
        },
        {
          ...assetBundleRemoteIdentity(input.projectId),
          expectedRevision: managementAssetDocument?.revision ?? 0,
          value: managementAssetDraft,
        },
        {
          ...episodeAssetDesignRemoteIdentity(input.projectId),
          expectedRevision: managementDesignDocument?.revision ?? 0,
          value: managementDesigns,
        },
        {
          ...workspaceSnapshotRemoteIdentity(input.projectId),
          expectedRevision: workspaceSnapshotDocument?.revision ?? 0,
          value: nextSnapshot,
        },
        {
          ...workspaceAssetsRemoteIdentity(input.projectId),
          expectedRevision: workspaceAssetDocument?.revision ?? 0,
          value: workspaceAssetDraft,
        },
        {
          ...workspaceEpisodeDesignsRemoteIdentity(input.projectId),
          expectedRevision: workspaceDesignDocument?.revision ?? 0,
          value: workspaceDesigns,
        },
        ...[...notificationStates.entries()].map(([userId, state]) => ({
          ...notificationsRemoteIdentity(userId),
          expectedRevision: state.document?.revision ?? 0,
          value: state.file,
        })),
      ],
      blobChecks,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'REMOTE_BLOB_SOURCE_NOT_FOUND') {
      return {
        ok: false,
        code: 'GENERATED_MEDIA_INVALID',
        message: '生成图片不存在',
        status: 422,
      };
    }
    throw error;
  }

  return {
    ok: true,
    submission: updatedSubmission,
    approvedCount: updatedSubmission.items.filter(
      (item) => item.status === 'approved',
    ).length,
    pendingCount,
    promoted,
  };
}

export async function approveRemoteAssetApprovalItems(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  approverUserId: string;
}): Promise<ApproveAssetApprovalResult> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await approveRemoteAttempt(input);
    } catch (error) {
      if (!isRemoteRevisionConflict(error)) throw error;
    }
  }
  throw new Error('REMOTE_DATA_WRITE_FAILED:409');
}
