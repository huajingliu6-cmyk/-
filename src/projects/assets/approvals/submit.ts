import { randomUUID } from "crypto";

import { runProjectAssetTransaction } from "@/projects/assets/remote-transaction-client";
import { isRemoteDataOnly, isRemoteRevisionConflict } from "@/persistence/remote-data-client";
import {
  createNotification,
  normalizeNotificationsFile,
} from "@/notifications/store";
import {
  loadRemoteNotificationsDocument,
  notificationsRemoteIdentity,
} from "@/notifications/remote-store";
import type { AppNotification } from "@/notifications/types";
import {
  findCandidateByMediaId,
  listApprovalCandidates,
} from "@/projects/assets/approvals/candidates";
import { withProjectApprovalLock } from "@/projects/assets/approvals/lock";
import {
  computeSubmissionStatus,
  findSubmissionByIdempotencyKey,
  loadAssetApprovalsFile,
  normalizeAssetApprovalsFile,
  saveAssetApprovalsFile,
} from "@/projects/assets/approvals/store";
import {
  assetApprovalsRemoteIdentity,
  loadAssetApprovalsRemoteDocument,
} from "@/projects/assets/approvals/remote-store";
import type {
  AssetApprovalItem,
  AssetApprovalSubmission,
} from "@/projects/assets/approvals/types";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
} from "@/projects/assets/episode-design/design-media-voice";
import { getDesignMediaVideoRefSafety } from "@/projects/assets/episode-design/design-media-video-ref-precheck";
import { getProjectRecord } from "@/projects/project-access";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

export type SubmitAssetApprovalResult =
  | {
      ok: true;
      submission: AssetApprovalSubmission;
      counts: { character: number; scene: number; prop: number; total: number };
      reused: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

function countByCategory(items: AssetApprovalItem[]) {
  const counts = { character: 0, scene: 0, prop: 0, total: 0 };
  for (const item of items) {
    counts[item.category] += 1;
    counts.total += 1;
  }
  return counts;
}

async function submitAssetApprovalAttempt(input: {
  projectId: string;
  episodeId: string;
  generatedMediaIds: string[];
  submittedByUserId: string;
  idempotencyKey?: string | null;
}): Promise<SubmitAssetApprovalResult> {
  const operation = async (): Promise<SubmitAssetApprovalResult> => {
    const project = await getProjectRecord(input.projectId);
    if (!project) {
      return {
        ok: false,
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
        status: 404,
      };
    }

    if (input.idempotencyKey) {
      const file = await loadAssetApprovalsFile(input.projectId);
      const existing = findSubmissionByIdempotencyKey(
        file,
        input.idempotencyKey,
      );
      if (existing) {
        return {
          ok: true,
          submission: existing,
          counts: countByCategory(existing.items),
          reused: true,
        };
      }
    }

    const uniqueIds = [
      ...new Set(
        input.generatedMediaIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (uniqueIds.length === 0) {
      return {
        ok: false,
        code: "INVALID_APPROVAL_SELECTION",
        message: "请至少选择一张图片",
        status: 400,
      };
    }

    const detail = await getWorkspaceEpisodeAssetDesignDetail(
      input.projectId,
      input.episodeId,
    );
    if (!detail.ok) {
      return {
        ok: false,
        code: detail.code,
        message: detail.message,
        status: 404,
      };
    }

    const listed = await listApprovalCandidates({
      projectId: input.projectId,
      episodeId: input.episodeId,
    });
    if (!listed.ok) {
      return {
        ok: false,
        code: listed.code,
        message: listed.message,
        status: 400,
      };
    }

    const accepted: Array<{
      mediaId: string;
      candidate: NonNullable<ReturnType<typeof findCandidateByMediaId>>;
    }> = [];

    for (const mediaId of uniqueIds) {
      const candidate = findCandidateByMediaId(listed.candidates, mediaId);
      if (!candidate) {
        return {
          ok: false,
          code: "GENERATED_MEDIA_INVALID",
          message: `图片 ${mediaId} 无效或不属于本集`,
          status: 422,
        };
      }
      if (candidate.status === "pending_approval") {
        return {
          ok: false,
          code: "APPROVAL_ITEM_ALREADY_PENDING",
          message: `图片「${candidate.assetName}」已在待审批中`,
          status: 409,
        };
      }
      if (candidate.status === "approved" || candidate.status === "in_library") {
        return {
          ok: false,
          code: "GENERATED_MEDIA_INVALID",
          message: `图片「${candidate.assetName}」已审批或已入库，不可重复提交`,
          status: 422,
        };
      }
      if (candidate.status !== "submittable") {
        return {
          ok: false,
          code: "GENERATED_MEDIA_INVALID",
          message: "存在不可提交的图片",
          status: 422,
        };
      }
      accepted.push({ mediaId, candidate });
    }

    const designById = new Map(
      detail.record.items.map((item) => [item.id, item]),
    );

    for (const { mediaId, candidate } of accepted) {
      if (candidate.category !== "character") continue;
      const designItem = designById.get(candidate.assetDesignItemId);
      if (designItem?.assetType !== "character") continue;
      const binding = getDesignMediaVoiceBinding(designItem, mediaId);
      if (!isMediaVoiceBound(binding)) {
        return {
          ok: false,
          code: "CHARACTER_VOICE_REQUIRED",
          message: `角色「${candidate.assetName}」的生成图尚未绑定音色（每张历史图需单独绑定）。请打开设计弹窗选中该图，选择音色并点击「绑定音色」后再提交。`,
          status: 422,
        };
      }
    }

    for (const { mediaId, candidate } of accepted) {
      if (candidate.category !== "character") continue;
      const designItem = designById.get(candidate.assetDesignItemId);
      if (designItem?.assetType !== "character") continue;
      // Server-side only: prefer history entry for this mediaId (never trust client).
      const safety = getDesignMediaVideoRefSafety(
        designItem.generatedMedia,
        mediaId,
      );
      if (!isSd2CertifiedForVideoRef(safety)) {
        return {
          ok: false,
          code: "VIDEO_REF_REQUIRED",
          message: `角色「${candidate.assetName}」的生成图尚未通过 SD 真人素材认证。请打开设计弹窗选中该图，完成「人物校验」后再提交审批。`,
          status: 422,
        };
      }
    }

    const now = new Date().toISOString();
    const submissionId = `aas_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const items: AssetApprovalItem[] = accepted.map(({ mediaId, candidate }) => {
      const designItem = designById.get(candidate.assetDesignItemId);
      const binding =
        designItem?.assetType === "character"
          ? getDesignMediaVoiceBinding(designItem, mediaId)
          : null;
      const voiceBound = binding != null && isMediaVoiceBound(binding);
      return {
        id: `aai_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        submissionId,
        category: candidate.category,
        assetDesignItemId: candidate.assetDesignItemId,
        assetNameSnapshot: candidate.assetName,
        generatedMediaId: mediaId,
        generatedAtSnapshot: candidate.generatedAt || now,
        storageKey: mediaId,
        promptSnapshot: candidate.prompt,
        voiceIdSnapshot: voiceBound ? binding!.voiceId : null,
        voiceNameSnapshot: voiceBound ? binding!.voiceName : null,
        status: "pending" as const,
        approvedByUserId: null,
        approvedAt: null,
        rejectedByUserId: null,
        rejectedAt: null,
        promotedAssetId: null,
      };
    });

    const submission: AssetApprovalSubmission = {
      id: submissionId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      submittedByUserId: input.submittedByUserId,
      approverUserId: project.ownerId,
      status: computeSubmissionStatus(items),
      items,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      completedAt: null,
      revision: 1,
      idempotencyKey: input.idempotencyKey ?? null,
    };

    const remoteApprovalDocument = isRemoteDataOnly()
      ? await loadAssetApprovalsRemoteDocument(input.projectId)
      : null;
    const file = remoteApprovalDocument
      ? normalizeAssetApprovalsFile(remoteApprovalDocument.value)
      : await loadAssetApprovalsFile(input.projectId);
    if (input.idempotencyKey) {
      const existing = findSubmissionByIdempotencyKey(file, input.idempotencyKey);
      if (existing) {
        return {
          ok: true,
          submission: existing,
          counts: countByCategory(existing.items),
          reused: true,
        };
      }
    }
    const unavailableMediaIds = new Set(
      file.submissions.flatMap((existingSubmission) =>
        existingSubmission.items
          .filter((item) => item.status === "pending" || item.status === "approved")
          .map((item) => item.generatedMediaId),
      ),
    );
    if (items.some((item) => unavailableMediaIds.has(item.generatedMediaId))) {
      return {
        ok: false,
        code: "APPROVAL_ITEM_ALREADY_PENDING",
        message: "Selected media is already pending or approved",
        status: 409,
      };
    }
    file.submissions.push(submission);
    file.revision += 1;

    const counts = countByCategory(items);
    const episodeNumber = detail.record.episodeNumber;
    const notificationInput = {
      recipientUserId: project.ownerId,
      type: "asset_approval_submitted" as const,
      projectId: input.projectId,
      episodeId: input.episodeId,
      submissionId,
      submitterUserId: input.submittedByUserId,
      title: "收到新的素材审批申请",
      summary: `第 ${episodeNumber} 集有 ${counts.character} 张人物、${counts.scene} 张场景、${counts.prop} 张道具图片待审批`,
      dedupeBySubmissionId: true,
    };

    if (isRemoteDataOnly()) {
      const notificationDocument = await loadRemoteNotificationsDocument(
        project.ownerId,
      );
      const notifications = normalizeNotificationsFile(
        notificationDocument?.value,
      );
      const notification: AppNotification = {
        id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        recipientUserId: notificationInput.recipientUserId,
        type: notificationInput.type,
        projectId: notificationInput.projectId,
        episodeId: notificationInput.episodeId,
        submissionId: notificationInput.submissionId,
        submitterUserId: notificationInput.submitterUserId,
        title: notificationInput.title,
        summary: notificationInput.summary,
        createdAt: now,
        readAt: null,
      };
      notifications.notifications.push(notification);
      file.updatedAt = now;
      await runProjectAssetTransaction({
        writes: [
          {
            ...assetApprovalsRemoteIdentity(input.projectId),
            expectedRevision: remoteApprovalDocument?.revision ?? 0,
            value: file,
          },
          {
            ...notificationsRemoteIdentity(project.ownerId),
            expectedRevision: notificationDocument?.revision ?? 0,
            value: notifications,
          },
        ],
      });
    } else {
      await saveAssetApprovalsFile(input.projectId, file);
      await createNotification(notificationInput);
    }

    return { ok: true, submission, counts, reused: false };
  };
  return isRemoteDataOnly()
    ? operation()
    : withProjectApprovalLock(input.projectId, operation);
}

export async function submitAssetApproval(input: {
  projectId: string;
  episodeId: string;
  generatedMediaIds: string[];
  submittedByUserId: string;
  idempotencyKey?: string | null;
}): Promise<SubmitAssetApprovalResult> {
  if (!isRemoteDataOnly()) return submitAssetApprovalAttempt(input);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await submitAssetApprovalAttempt(input);
    } catch (error) {
      if (!isRemoteRevisionConflict(error)) throw error;
    }
  }
  throw new Error("REMOTE_DATA_WRITE_FAILED:409");
}
