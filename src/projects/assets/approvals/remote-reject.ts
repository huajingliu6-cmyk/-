import 'server-only';

import { runProjectAssetTransaction } from "@/projects/assets/remote-transaction-client";

import { randomUUID } from 'crypto';
import {
  loadRemoteNotificationsDocument,
  notificationsRemoteIdentity,
} from '@/notifications/remote-store';
import { normalizeNotificationsFile } from '@/notifications/store';
import type { AppNotification, NotificationsFile } from '@/notifications/types';
import { isRemoteRevisionConflict } from '@/persistence/remote-data-client';
import {
  assetApprovalsRemoteIdentity,
  loadAssetApprovalsRemoteDocument,
} from '@/projects/assets/approvals/remote-store';
import {
  computeSubmissionStatus,
  findSubmission,
  normalizeAssetApprovalsFile,
} from '@/projects/assets/approvals/store';
import type { RejectAssetApprovalResult } from '@/projects/assets/approvals/reject';
import type { AssetApprovalSubmission } from '@/projects/assets/approvals/types';
import { getWorkspaceEpisodeAssetDesignDetail } from '@/projects/workspace-sync/workspace-episode-design-api';

type NotificationDocumentState = {
  document: Awaited<ReturnType<typeof loadRemoteNotificationsDocument>>;
  file: NotificationsFile;
};

function rejectionCounts(submission: AssetApprovalSubmission) {
  return {
    pendingCount: submission.items.filter((item) => item.status === 'pending')
      .length,
    approvedCount: submission.items.filter((item) => item.status === 'approved')
      .length,
    rejectedCount: submission.items.filter((item) => item.status === 'rejected')
      .length,
  };
}

async function rejectRemoteAttempt(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  rejectorUserId: string;
}): Promise<RejectAssetApprovalResult> {
  const approvalDocument = await loadAssetApprovalsRemoteDocument(
    input.projectId,
  );
  const file = normalizeAssetApprovalsFile(approvalDocument?.value);
  const submission = findSubmission(file, input.submissionId);
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
      message: '请至少选择一个待驳回条目',
      status: 400,
    };
  }
  for (const itemId of uniqueItemIds) {
    const item = submission.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return {
        ok: false,
        code: 'INVALID_APPROVAL_SELECTION',
        message: `审批条目不存在：${itemId}`,
        status: 400,
      };
    }
    if (item.status === 'approved') {
      return {
        ok: false,
        code: 'APPROVAL_ITEM_ALREADY_APPROVED',
        message: `“${item.assetNameSnapshot}”已通过，无法驳回`,
        status: 409,
      };
    }
  }

  const now = new Date().toISOString();
  let newlyRejected = 0;
  const nextItems = submission.items.map((item) => {
    if (!uniqueItemIds.includes(item.id) || item.status === 'rejected') {
      return item;
    }
    newlyRejected += 1;
    return {
      ...item,
      status: 'rejected' as const,
      rejectedByUserId: input.rejectorUserId,
      rejectedAt: now,
      approvedByUserId: null,
      approvedAt: null,
      promotedAssetId: null,
    };
  });
  if (newlyRejected === 0) {
    return { ok: true, submission, ...rejectionCounts(submission) };
  }

  const status = computeSubmissionStatus(nextItems);
  const updated: AssetApprovalSubmission = {
    ...submission,
    items: nextItems,
    status,
    updatedAt: now,
    completedAt:
      status === 'approved' || status === 'rejected'
        ? now
        : submission.completedAt,
    revision: submission.revision + 1,
  };
  file.submissions = file.submissions.map((candidate) =>
    candidate.id === updated.id ? updated : candidate,
  );
  file.revision += 1;
  file.updatedAt = now;
  const counts = rejectionCounts(updated);

  const notificationUserIds = new Set([submission.submittedByUserId]);
  if (counts.pendingCount === 0) {
    notificationUserIds.add(submission.approverUserId);
  }
  const notificationStates = new Map<string, NotificationDocumentState>();
  await Promise.all(
    [...notificationUserIds].map(async (userId) => {
      const document = await loadRemoteNotificationsDocument(userId);
      notificationStates.set(userId, {
        document,
        file: normalizeNotificationsFile(document?.value),
      });
    }),
  );

  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    submission.episodeId,
  );
  const episodeNumber = detail.ok ? detail.record.episodeNumber : 0;
  const submitterState = notificationStates.get(submission.submittedByUserId)!;
  const rejectedNotification: AppNotification = {
    id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    recipientUserId: submission.submittedByUserId,
    type: 'asset_approval_rejected',
    projectId: input.projectId,
    episodeId: submission.episodeId,
    submissionId: submission.id,
    submitterUserId: submission.submittedByUserId,
    title: '素材审批已驳回',
    summary: `第 ${episodeNumber} 集有 ${newlyRejected} 张素材被项目主人驳回，未进入项目管理与资产库。`,
    createdAt: now,
    readAt: null,
  };
  submitterState.file.notifications.push(rejectedNotification);

  if (counts.pendingCount === 0) {
    const approverState = notificationStates.get(submission.approverUserId)!;
    approverState.file.notifications = approverState.file.notifications.map(
      (notification) =>
        notification.submissionId === submission.id &&
        notification.type === 'asset_approval_submitted' &&
        !notification.readAt
          ? { ...notification, readAt: now }
          : notification,
    );
  }

  await runProjectAssetTransaction({
    writes: [
      {
        ...assetApprovalsRemoteIdentity(input.projectId),
        expectedRevision: approvalDocument?.revision ?? 0,
        value: file,
      },
      ...[...notificationStates.entries()].map(([userId, state]) => ({
        ...notificationsRemoteIdentity(userId),
        expectedRevision: state.document?.revision ?? 0,
        value: state.file,
      })),
    ],
  });

  return { ok: true, submission: updated, ...counts };
}

export async function rejectRemoteAssetApprovalItems(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  rejectorUserId: string;
}): Promise<RejectAssetApprovalResult> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await rejectRemoteAttempt(input);
    } catch (error) {
      if (!isRemoteRevisionConflict(error)) throw error;
    }
  }
  throw new Error('REMOTE_DATA_WRITE_FAILED:409');
}
