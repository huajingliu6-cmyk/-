import { createNotification, markNotificationsReadBySubmission } from "@/notifications/store";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { rejectRemoteAssetApprovalItems } from "@/projects/assets/approvals/remote-reject";
import { withProjectApprovalLock } from "@/projects/assets/approvals/lock";
import {
  computeSubmissionStatus,
  findSubmission,
  loadAssetApprovalsFile,
  saveAssetApprovalsFile,
} from "@/projects/assets/approvals/store";
import type { AssetApprovalSubmission } from "@/projects/assets/approvals/types";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";

export type RejectAssetApprovalResult =
  | {
      ok: true;
      submission: AssetApprovalSubmission;
      rejectedCount: number;
      pendingCount: number;
      approvedCount: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

export async function rejectAssetApprovalItems(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  rejectorUserId: string;
}): Promise<RejectAssetApprovalResult> {
  if (isRemoteDataOnly()) {
    return rejectRemoteAssetApprovalItems(input);
  }
  return withProjectApprovalLock(input.projectId, async () => {
    const file = await loadAssetApprovalsFile(input.projectId);
    const submission = findSubmission(file, input.submissionId);
    if (!submission || submission.projectId !== input.projectId) {
      return {
        ok: false,
        code: "APPROVAL_SUBMISSION_NOT_FOUND",
        message: "审批单不存在",
        status: 404,
      };
    }

    const uniqueItemIds = [
      ...new Set(
        input.itemIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (uniqueItemIds.length === 0) {
      return {
        ok: false,
        code: "INVALID_APPROVAL_SELECTION",
        message: "请至少选择一张待驳回图片",
        status: 400,
      };
    }

    for (const itemId of uniqueItemIds) {
      const item = submission.items.find((i) => i.id === itemId);
      if (!item) {
        return {
          ok: false,
          code: "INVALID_APPROVAL_SELECTION",
          message: `审批条目不存在：${itemId}`,
          status: 400,
        };
      }
      if (item.status === "approved") {
        return {
          ok: false,
          code: "APPROVAL_ITEM_ALREADY_APPROVED",
          message: `「${item.assetNameSnapshot}」已通过，无法驳回`,
          status: 409,
        };
      }
    }

    const now = new Date().toISOString();
    let nextItems = [...submission.items];
    let newlyRejected = 0;

    for (const itemId of uniqueItemIds) {
      const item = nextItems.find((i) => i.id === itemId)!;
      if (item.status === "rejected") continue;
      newlyRejected += 1;
      nextItems = nextItems.map((i) =>
        i.id === itemId
          ? {
              ...i,
              status: "rejected" as const,
              rejectedByUserId: input.rejectorUserId,
              rejectedAt: now,
              approvedByUserId: null,
              approvedAt: null,
              promotedAssetId: null,
            }
          : i,
      );
    }

    const status = computeSubmissionStatus(nextItems);
    const updated: AssetApprovalSubmission = {
      ...submission,
      items: nextItems,
      status,
      updatedAt: now,
      completedAt:
        status === "approved" || status === "rejected"
          ? now
          : submission.completedAt,
      revision: submission.revision + 1,
    };
    file.submissions = file.submissions.map((s) =>
      s.id === submission.id ? updated : s,
    );
    file.revision += 1;
    await saveAssetApprovalsFile(input.projectId, file);

    const pendingCount = updated.items.filter((i) => i.status === "pending")
      .length;
    const approvedCount = updated.items.filter((i) => i.status === "approved")
      .length;
    const rejectedCount = updated.items.filter((i) => i.status === "rejected")
      .length;

    if (newlyRejected > 0) {
      const detail = await getWorkspaceEpisodeAssetDesignDetail(
        input.projectId,
        submission.episodeId,
      );
      const episodeNumber = detail.ok ? detail.record.episodeNumber : 0;
      await createNotification({
        recipientUserId: submission.submittedByUserId,
        type: "asset_approval_rejected",
        projectId: input.projectId,
        episodeId: submission.episodeId,
        submissionId: submission.id,
        submitterUserId: submission.submittedByUserId,
        title: "素材审批已驳回",
        summary: `第 ${episodeNumber} 集有 ${newlyRejected} 张素材被主理人驳回，未进入项目管理与资产库。`,
      });
    }

    if (pendingCount === 0) {
      await markNotificationsReadBySubmission({
        userId: submission.approverUserId,
        submissionId: submission.id,
        types: ["asset_approval_submitted"],
      });
    }

    return {
      ok: true,
      submission: updated,
      rejectedCount,
      pendingCount,
      approvedCount,
    };
  });
}
