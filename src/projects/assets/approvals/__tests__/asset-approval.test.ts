import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import { writeProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import { emptyEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { submitAssetApproval } from "@/projects/assets/approvals/submit";
import { approveAssetApprovalItems } from "@/projects/assets/approvals/approve";
import { rejectAssetApprovalItems } from "@/projects/assets/approvals/reject";
import { listApprovalCandidates } from "@/projects/assets/approvals/candidates";
import {
  loadAssetApprovalsFile,
  computeSubmissionStatus,
} from "@/projects/assets/approvals/store";
import {
  countUnreadNotifications,
  deleteNotification,
  listNotificationsForUser,
  markNotificationRead,
} from "@/notifications/store";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  getEffectiveWorkspaceAssetBundle,
  getWorkspaceEpisodeAssetDesignDetail,
  saveWorkspaceEpisodeAssetDesignItems,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { isApprovedEpisodeDesignItem } from "@/projects/assets/episode-design/approved-item";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import {
  saveWorkspaceLocalAssets,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { POST as workspaceConfirm } from "@/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/confirm/route";
import { POST as workspaceSubmit } from "@/app/api/workspace/projects/[projectId]/asset-approvals/route";
import { POST as ownerApprove } from "@/app/api/projects/[projectId]/asset-approvals/[submissionId]/approve/route";
import { GET as listNotifications } from "@/app/api/notifications/route";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";

function auth(
  role: AuthUser["role"],
  id: string,
  username = id,
): AuthUser {
  return {
    id,
    username,
    role,
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeItem(
  id: string,
  assetType: "character" | "scene" | "prop",
  name: string,
  mediaId: string,
): EpisodeAssetDesignItem {
  const media = {
    currentId: mediaId,
    historyIds: [mediaId],
    history: [
      {
        mediaId,
        prompt: `prompt-${name}`,
        generatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    status: "completed" as const,
    promptFingerprint: "fp",
    errorMessage: null,
    mimeType: "image/png",
    previewKind: "image" as const,
  };
  if (assetType === "character") {
    return {
      id,
      name,
      assetType,
      resolution: "create_new",
      source: "manual",
      draft: {
        role: "主角",
        description: "d",
        appearance: "a",
        clothing: "c",
        age: "20",
        voiceId: "localvoice_test",
        voiceName: "测试音色",
        voiceBound: true,
        usageInEpisode: "出场",
        evidence: "e",
      },
      generatedMedia: {
        ...media,
        history: media.history.map((entry) =>
          entry.mediaId === mediaId
            ? {
                ...entry,
                voiceId: "localvoice_test",
                voiceName: "测试音色",
                voiceBound: true,
              }
            : entry,
        ),
      },
    };
  }
  if (assetType === "scene") {
    return {
      id,
      name,
      assetType,
      resolution: "create_new",
      source: "manual",
      draft: {
        description: "d",
        timeOfDay: "夜",
        location: "loc",
        style: "s",
        usageInEpisode: "出场",
        evidence: "e",
      },
      generatedMedia: media,
    };
  }
  return {
    id,
    name,
    assetType,
    resolution: "create_new",
    source: "manual",
    draft: {
      propType: "道具",
      usage: "u",
      description: "d",
      usageInEpisode: "出场",
      evidence: "e",
    },
    generatedMedia: media,
  };
}

async function seedEpisodeWithMedia(projectId: string) {
  const episodeId = `ep_${randomUUID().slice(0, 8)}`;
  const charMedia = `gen_char_${randomUUID().slice(0, 8)}`;
  const sceneMedia = `gen_scene_${randomUUID().slice(0, 8)}`;
  const propMedia = `gen_prop_${randomUUID().slice(0, 8)}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  for (const mediaId of [charMedia, sceneMedia, propMedia]) {
    await writeProjectAssetImageFile({
      projectId,
      assetId: mediaId,
      buffer: png,
      mimeType: "image/png",
    });
  }
  const items = [
    makeItem("item_char", "character", "角色A", charMedia),
    makeItem("item_scene", "scene", "场景A", sceneMedia),
    makeItem("item_prop", "prop", "道具A", propMedia),
  ];

  await saveScriptDraft({
    projectId,
    sourceFile: null,
    sourceText: "第一集正文内容用于审批测试",
    preambleNotes: null,
    sourceImport: null,
    novelTask: { status: "idle" },
    episodes: [
      {
        id: episodeId,
        projectId,
        episodeNumber: 1,
        title: "第一集",
        content: "第一集正文内容用于审批测试",
        status: "saved",
        updatedAt: new Date().toISOString(),
      },
    ],
    selectedId: episodeId,
    listPage: 1,
    splitConfig: { targetChars: 3000 },
    novelOpen: false,
    updatedAt: new Date().toISOString(),
  });
  await syncManagementToWorkspace(projectId);

  const store = emptyEpisodeAssetDesignStore(projectId);
  store.records.push({
    episodeId,
    episodeNumber: 1,
    status: "review",
    revision: 1,
    contentFingerprint: "fp1",
    generationId: null,
    items,
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: new Date().toISOString(),
  });
  await saveWorkspaceLocalEpisodeDesigns(store);
  return { episodeId, charMedia, sceneMedia, propMedia, items };
}

describe("WORKSPACE-ASSET-APPROVAL-H1", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-asset-approval-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates submission with three categories and one owner notification", async () => {
    const owner = auth("user", "owner-1");
    const engineer = auth("user", "ce-1");
    const project = await createProjectRecord(owner.id, {
      name: `appr-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      approvalEnabled: true,
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);

    const result = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [
        seeded.charMedia,
        seeded.sceneMedia,
        seeded.propMedia,
      ],
      submittedByUserId: engineer.id,
      idempotencyKey: "k1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts).toEqual({
      character: 1,
      scene: 1,
      prop: 1,
      total: 3,
    });
    expect(result.submission.status).toBe("pending");
    expect(result.submission.approverUserId).toBe(owner.id);

    const notes = await listNotificationsForUser(owner.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.submissionId).toBe(result.submission.id);
    expect(notes[0]?.recipientUserId).toBe(owner.id);
    expect(await countUnreadNotifications(owner.id)).toBe(1);

    const again = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: engineer.id,
      idempotencyKey: "k1",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reused).toBe(true);
    expect(again.submission.id).toBe(result.submission.id);
    expect(await listNotificationsForUser(owner.id)).toHaveLength(1);
  });

  it("rejects empty submit and duplicate pending media", async () => {
    const owner = auth("user", "owner-2");
    const project = await createProjectRecord(owner.id, {
      name: `appr2-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);

    const empty = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [],
      submittedByUserId: owner.id,
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.code).toBe("INVALID_APPROVAL_SELECTION");

    const first = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(first.ok).toBe(true);

    const dup = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe("APPROVAL_ITEM_ALREADY_PENDING");
  });

  it("partial then full approve promotes into management and workspace libraries", async () => {
    const owner = auth("user", "owner-3");
    const project = await createProjectRecord(owner.id, {
      name: `appr3-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [
        seeded.charMedia,
        seeded.sceneMedia,
        seeded.propMedia,
      ],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const itemIds = submitted.submission.items.map((i) => i.id);
    const firstTwo = itemIds.slice(0, 2);
    const partial = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: firstTwo,
      approverUserId: owner.id,
    });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.submission.status).toBe("partially_approved");
    expect(partial.pendingCount).toBe(1);
    expect(partial.approvedCount).toBe(2);

    const mgmt = await loadAssetBundleDraft(project.projectId);
    expect(mgmt).toBeTruthy();
    const promotedMedia = new Set(
      [
        ...(mgmt?.characters ?? []).flatMap((a) => [
          a.imageFileName,
          ...(a.approvedMediaIds ?? []),
        ]),
        ...(mgmt?.scenes ?? []).flatMap((a) => [
          a.imageFileName,
          ...(a.approvedMediaIds ?? []),
        ]),
        ...(mgmt?.props ?? []).flatMap((a) => [
          a.imageFileName,
          ...(a.approvedMediaIds ?? []),
        ]),
      ].filter(Boolean),
    );
    expect(promotedMedia.has(seeded.charMedia) || promotedMedia.has(seeded.sceneMedia)).toBe(
      true,
    );

    // local override should not hide approved assets after merge
    await saveWorkspaceLocalAssets({
      projectId: project.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    });
    // re-merge by approving remaining will refresh; also check effective after re-approve path
    const rest = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: [itemIds[2]!],
      approverUserId: owner.id,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.submission.status).toBe("approved");

    const effective = await getEffectiveWorkspaceAssetBundle(project.projectId);
    const allIds = [
      ...effective.characters.flatMap((a) => [
        a.imageFileName,
        ...(a.approvedMediaIds ?? []),
      ]),
      ...effective.scenes.flatMap((a) => [
        a.imageFileName,
        ...(a.approvedMediaIds ?? []),
      ]),
      ...effective.props.flatMap((a) => [
        a.imageFileName,
        ...(a.approvedMediaIds ?? []),
      ]),
    ];
    expect(allIds).toEqual(
      expect.arrayContaining([
        seeded.charMedia,
        seeded.sceneMedia,
        seeded.propMedia,
      ]),
    );

    // idempotent re-approve
    const again = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: itemIds,
      approverUserId: owner.id,
    });
    expect(again.ok).toBe(true);
    const mgmt2 = await loadAssetBundleDraft(project.projectId);
    expect(mgmt2?.characters.length).toBe(mgmt?.characters.length ?? 1);
  });

  it("workspace cannot delete approved design items; management save can", async () => {
    const owner = auth("user", "owner-del");
    const project = await createProjectRecord(owner.id, {
      name: `appr-del-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const approved = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: submitted.submission.items.map((i) => i.id),
      approverUserId: owner.id,
    });
    expect(approved.ok).toBe(true);

    const workspaceDetail = await getWorkspaceEpisodeAssetDesignDetail(
      project.projectId,
      seeded.episodeId,
    );
    expect(workspaceDetail.ok).toBe(true);
    if (!workspaceDetail.ok) return;

    const protectedItems = workspaceDetail.record.items.filter(
      isApprovedEpisodeDesignItem,
    );
    expect(protectedItems.length).toBeGreaterThan(0);

    const withoutApproved = workspaceDetail.record.items.filter(
      (item) => !isApprovedEpisodeDesignItem(item),
    );
    const blocked = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      expectedRevision: workspaceDetail.record.revision,
      fingerprint: workspaceDetail.currentFingerprint,
      items: withoutApproved,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("APPROVED_ITEM_DELETE_FORBIDDEN");
    }

    const mgmtDetail = await getEpisodeAssetDesignDetail(
      project.projectId,
      seeded.episodeId,
    );
    expect(mgmtDetail.ok).toBe(true);
    if (!mgmtDetail.ok) return;

    const mgmtWithoutApproved = mgmtDetail.record.items.filter(
      (item) => !isApprovedEpisodeDesignItem(item),
    );
    const mgmtSave = await saveEpisodeAssetDesignItems({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      expectedRevision: mgmtDetail.record.revision,
      fingerprint: mgmtDetail.currentFingerprint,
      items: mgmtWithoutApproved,
    });
    expect(mgmtSave.ok).toBe(true);
  });

  it("candidate statuses: pending / approved / in_library", async () => {
    const owner = auth("user", "owner-4");
    const project = await createProjectRecord(owner.id, {
      name: `appr4-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    let listed = await listApprovalCandidates({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(
      listed.candidates.find((c) => c.generatedMediaId === seeded.charMedia)
        ?.status,
    ).toBe("pending_approval");

    await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: [submitted.submission.items[0]!.id],
      approverUserId: owner.id,
    });

    listed = await listApprovalCandidates({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const status = listed.candidates.find(
      (c) => c.generatedMediaId === seeded.charMedia,
    )?.status;
    expect(status === "approved" || status === "in_library").toBe(true);
  });

  it("notifications persist mark-read and retain history", async () => {
    const owner = auth("user", "owner-5");
    const project = await createProjectRecord(owner.id, {
      name: `appr5-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.propMedia],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const notes = await listNotificationsForUser(owner.id);
    expect(notes[0]?.readAt).toBeNull();
    const marked = await markNotificationRead({
      userId: owner.id,
      notificationId: notes[0]!.id,
    });
    expect(marked?.readAt).toBeTruthy();
    expect(await countUnreadNotifications(owner.id)).toBe(0);
    expect(await listNotificationsForUser(owner.id)).toHaveLength(1);
  });

  it("completed notifications can be deleted without wiping approval records", async () => {
    const owner = auth("user", "owner-del-note");
    const project = await createProjectRecord(owner.id, {
      name: `appr-del-note-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const unread = await listNotificationsForUser(owner.id);
    const blocked = await deleteNotification({
      userId: owner.id,
      notificationId: unread[0]!.id,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("NOT_COMPLETED");

    await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: submitted.submission.items.map((i) => i.id),
      approverUserId: owner.id,
    });

    const notes = await listNotificationsForUser(owner.id);
    const ownerNote = notes.find((n) => n.type === "asset_approval_submitted");
    expect(ownerNote?.readAt).toBeTruthy();

    const deleted = await deleteNotification({
      userId: owner.id,
      notificationId: ownerNote!.id,
    });
    expect(deleted.ok).toBe(true);
    expect(
      (await listNotificationsForUser(owner.id)).some(
        (n) => n.id === ownerNote!.id,
      ),
    ).toBe(false);

    const file = await loadAssetApprovalsFile(project.projectId);
    expect(file.submissions.some((s) => s.id === submitted.submission.id)).toBe(
      true,
    );
  });

  it("computeSubmissionStatus covers pending / partial / approved / rejected", () => {
    expect(computeSubmissionStatus([])).toBe("pending");
    expect(
      computeSubmissionStatus([
        { status: "pending" } as never,
        { status: "pending" } as never,
      ]),
    ).toBe("pending");
    expect(
      computeSubmissionStatus([
        { status: "approved" } as never,
        { status: "pending" } as never,
      ]),
    ).toBe("partially_approved");
    expect(
      computeSubmissionStatus([
        { status: "approved" } as never,
        { status: "rejected" } as never,
      ]),
    ).toBe("partially_approved");
    expect(
      computeSubmissionStatus([
        { status: "approved" } as never,
        { status: "approved" } as never,
      ]),
    ).toBe("approved");
    expect(
      computeSubmissionStatus([
        { status: "rejected" } as never,
        { status: "rejected" } as never,
      ]),
    ).toBe("rejected");
  });

  it("reject skips promote and notifies submitter; owner unread until fully decided", async () => {
    const owner = auth("user", "owner-reject");
    const engineer = auth("user", "ce-reject");
    const project = await createProjectRecord(owner.id, {
      name: `appr-rej-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);

    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia, seeded.sceneMedia],
      submittedByUserId: engineer.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    expect(await countUnreadNotifications(owner.id)).toBe(1);

    const [rejectItem, approveItem] = submitted.submission.items;
    const rejected = await rejectAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: [rejectItem!.id],
      rejectorUserId: owner.id,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.submission.status).toBe("partially_approved");
    expect(rejected.pendingCount).toBe(1);
    expect(rejected.rejectedCount).toBe(1);

    // Owner submit notice stays unread while anything is still pending
    expect(await countUnreadNotifications(owner.id)).toBe(1);

    const engineerNotesAfterReject = await listNotificationsForUser(engineer.id);
    expect(
      engineerNotesAfterReject.some((n) => n.type === "asset_approval_rejected"),
    ).toBe(true);

    const mgmtAfterReject = await loadAssetBundleDraft(project.projectId);
    const promotedAfterReject = [
      ...(mgmtAfterReject?.characters ?? []),
      ...(mgmtAfterReject?.scenes ?? []),
      ...(mgmtAfterReject?.props ?? []),
    ].flatMap((a) => [a.imageFileName, ...(a.approvedMediaIds ?? [])]);
    expect(promotedAfterReject).not.toContain(rejectItem!.generatedMediaId);

    const approved = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: [approveItem!.id],
      approverUserId: owner.id,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.pendingCount).toBe(0);

    // Fully decided — owner submit notice marked read
    expect(await countUnreadNotifications(owner.id)).toBe(0);

    const engineerNotes = await listNotificationsForUser(engineer.id);
    expect(
      engineerNotes.some((n) => n.type === "asset_approval_approved"),
    ).toBe(true);
    expect(
      engineerNotes.some((n) => n.type === "asset_approval_rejected"),
    ).toBe(true);

    const mgmt = await loadAssetBundleDraft(project.projectId);
    const promoted = [
      ...(mgmt?.characters ?? []),
      ...(mgmt?.scenes ?? []),
      ...(mgmt?.props ?? []),
    ].flatMap((a) => [a.imageFileName, ...(a.approvedMediaIds ?? [])]);
    expect(promoted).toContain(approveItem!.generatedMediaId);
    expect(promoted).not.toContain(rejectItem!.generatedMediaId);
  });

  it("workspace confirm API is blocked (anti-bypass)", async () => {
    const owner = auth("user", "owner-6");
    const project = await createProjectRecord(owner.id, {
      name: `appr6-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      approvalEnabled: true,
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const res = await workspaceConfirm(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ expectedRevision: 1, fingerprint: "x" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          episodeId: "ep_x",
        }),
      },
    );
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe("WORKSPACE_CONFIRM_REQUIRES_APPROVAL");
  });

  it("CE can submit via API but cannot approve; owner can approve", async () => {
    const owner = auth("user", "owner-7");
    const engineer = auth("user", "ce-7");
    const stranger = auth("user", "stranger-7");
    const project = await createProjectRecord(owner.id, {
      name: `appr7-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const submitRes = await workspaceSubmit(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: seeded.episodeId,
          generatedMediaIds: [seeded.sceneMedia],
        }),
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(submitRes.status).toBe(200);
    const submitPayload = (await submitRes.json()) as {
      submission: { id: string; items: Array<{ id: string }> };
    };

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: stranger,
    });
    const denySubmit = await workspaceSubmit(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: seeded.episodeId,
          generatedMediaIds: [seeded.propMedia],
        }),
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(denySubmit.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const denyApprove = await ownerApprove(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: [submitPayload.submission.items[0]!.id],
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          submissionId: submitPayload.submission.id,
        }),
      },
    );
    expect(denyApprove.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const okApprove = await ownerApprove(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: [submitPayload.submission.items[0]!.id],
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          submissionId: submitPayload.submission.id,
        }),
      },
    );
    expect(okApprove.status).toBe(200);

    const notesRes = await listNotifications();
    expect(notesRes.status).toBe(200);
  });

  it("rejects invalid item ids on approve", async () => {
    const owner = auth("user", "owner-8");
    const project = await createProjectRecord(owner.id, {
      name: `appr8-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    const submitted = await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const bad = await approveAssetApprovalItems({
      projectId: project.projectId,
      submissionId: submitted.submission.id,
      itemIds: ["not-real"],
      approverUserId: owner.id,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("INVALID_APPROVAL_SELECTION");
  });

  it("old assets without approval fields still parse", async () => {
    const owner = auth("user", "owner-9");
    const project = await createProjectRecord(owner.id, {
      name: `appr9-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const drafts = path.join(
      process.env.APP_DATA_DIR!,
      "projects",
      project.projectId,
      "drafts",
    );
    mkdirSync(drafts, { recursive: true });
    writeFileSync(
      path.join(drafts, "assets.json"),
      JSON.stringify({
        projectId: project.projectId,
        characters: [
          {
            id: "c1",
            projectId: project.projectId,
            name: "旧角色",
            role: "",
            description: "",
            appearance: "",
            clothing: "",
            age: "",
            gender: "",
            voiceId: null,
            voiceName: null,
            voiceStyle: null,
            imageFileName: null,
            imageObjectUrl: null,
            imageMimeType: null,
            status: "draft",
          },
        ],
        scenes: [],
        props: [],
        audios: [],
        updatedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft?.characters[0]?.name).toBe("旧角色");
    expect(draft?.characters[0]?.approvedMediaIds).toBeUndefined();
  });

  it("file store revision increments on save", async () => {
    const owner = auth("user", "owner-10");
    const project = await createProjectRecord(owner.id, {
      name: `appr10-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const seeded = await seedEpisodeWithMedia(project.projectId);
    await submitAssetApproval({
      projectId: project.projectId,
      episodeId: seeded.episodeId,
      generatedMediaIds: [seeded.charMedia],
      submittedByUserId: owner.id,
    });
    const file = await loadAssetApprovalsFile(project.projectId);
    expect(file.revision).toBeGreaterThan(0);
    expect(file.submissions).toHaveLength(1);
  });
});
