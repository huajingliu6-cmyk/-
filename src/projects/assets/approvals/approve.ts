import { createNotification, markNotificationsReadBySubmission } from "@/notifications/store";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { approveRemoteAssetApprovalItems } from "@/projects/assets/approvals/remote-approve";
import { withProjectApprovalLock } from "@/projects/assets/approvals/lock";
import { promoteApprovalItem } from "@/projects/assets/approvals/promote";
import {
  computeSubmissionStatus,
  findSubmission,
  loadAssetApprovalsFile,
  saveAssetApprovalsFile,
} from "@/projects/assets/approvals/store";
import type { AssetApprovalSubmission } from "@/projects/assets/approvals/types";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";

export type ApproveAssetApprovalResult =
  | {
      ok: true;
      submission: AssetApprovalSubmission;
      approvedCount: number;
      pendingCount: number;
      promoted: Array<{ itemId: string; assetId: string; created: boolean }>;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

export async function approveAssetApprovalItems(input: {
  projectId: string;
  submissionId: string;
  itemIds: string[];
  approverUserId: string;
}): Promise<ApproveAssetApprovalResult> {
  if (isRemoteDataOnly()) {
    return approveRemoteAssetApprovalItems(input);
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
        message: "请至少选择一张待审批图片",
        status: 400,
      };
    }

    for (const itemId of uniqueItemIds) {
      if (!submission.items.some((i) => i.id === itemId)) {
        return {
          ok: false,
          code: "INVALID_APPROVAL_SELECTION",
          message: `审批条目不存在：${itemId}`,
          status: 400,
        };
      }
    }

    const detail = await getWorkspaceEpisodeAssetDesignDetail(
      input.projectId,
      submission.episodeId,
    );
    const episodeNumber = detail.ok ? detail.record.episodeNumber : 0;

    const now = new Date().toISOString();
    const promoted: Array<{
      itemId: string;
      assetId: string;
      created: boolean;
    }> = [];
    let nextItems = [...submission.items];

    for (const itemId of uniqueItemIds) {
      const idx = nextItems.findIndex((i) => i.id === itemId);
      const item = nextItems[idx]!;
      if (item.status === "approved" && item.promotedAssetId) {
        promoted.push({
          itemId: item.id,
          assetId: item.promotedAssetId,
          created: false,
        });
        continue;
      }

      const result = await promoteApprovalItem({
        projectId: input.projectId,
        episodeId: submission.episodeId,
        episodeNumber,
        submissionId: submission.id,
        item,
        submittedByUserId: submission.submittedByUserId,
        submittedAt: submission.submittedAt,
        approvedByUserId: input.approverUserId,
        approvedAt: now,
      });

      if (!result.ok) {
        // Per-item atomic: keep earlier successes; fail this item without marking approved
        return {
          ok: false,
          code: result.code,
          message: result.message,
          status: result.code === "GENERATED_MEDIA_INVALID" ? 422 : 400,
        };
      }

      nextItems = nextItems.map((i) =>
        i.id === itemId
          ? {
              ...i,
              status: "approved" as const,
              approvedByUserId: input.approverUserId,
              approvedAt: now,
              promotedAssetId: result.assetId,
            }
          : i,
      );
      promoted.push({
        itemId,
        assetId: result.assetId,
        created: result.created,
      });

      // Persist after each successful item so status matches library
      const status = computeSubmissionStatus(nextItems);
      const updated: AssetApprovalSubmission = {
        ...submission,
        items: nextItems,
        status,
        updatedAt: now,
        completedAt: status === "approved" ? now : submission.completedAt,
        revision: submission.revision + 1,
      };
      const latestFile = await loadAssetApprovalsFile(input.projectId);
      latestFile.submissions = latestFile.submissions.map((s) =>
        s.id === submission.id ? updated : s,
      );
      latestFile.revision += 1;
      await saveAssetApprovalsFile(input.projectId, latestFile);
      Object.assign(submission, updated);
    }

    const finalFile = await loadAssetApprovalsFile(input.projectId);
    const finalSubmission = findSubmission(finalFile, input.submissionId)!;
    const pendingCount = finalSubmission.items.filter(
      (i) => i.status === "pending",
    ).length;
    const approvedCount = finalSubmission.items.filter(
      (i) => i.status === "approved",
    ).length;

    if (promoted.length > 0) {
      await createNotification({
        recipientUserId: finalSubmission.submittedByUserId,
        type: "asset_approval_approved",
        projectId: input.projectId,
        episodeId: finalSubmission.episodeId,
        submissionId: finalSubmission.id,
        submitterUserId: finalSubmission.submittedByUserId,
        title: "素材审批已通过",
        summary: `第 ${episodeNumber} 集有 ${promoted.length} 张素材已通过审批并入库。`,
      });
    }
    if (pendingCount === 0) {
      await markNotificationsReadBySubmission({
        userId: finalSubmission.approverUserId,
        submissionId: finalSubmission.id,
        types: ["asset_approval_submitted"],
      });
    }

    return {
      ok: true,
      submission: finalSubmission,
      approvedCount,
      pendingCount,
      promoted,
    };
  });
}
