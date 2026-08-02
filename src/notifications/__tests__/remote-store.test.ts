import { mkdtemp, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification, NotificationType } from "@/notifications/types";

const notificationsByUser = vi.hoisted(
  () => new Map<string, AppNotification[]>(),
);
const state = vi.hoisted(() => ({ injectConcurrentNotification: false }));

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;

    if (method === "GET") {
      const userId = url.searchParams.get("userId") ?? "";
      const notifications = [...(notificationsByUser.get(userId) ?? [])].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt),
      );
      return response({
        notifications,
        unreadCount: notifications.filter((item) => !item.readAt).length,
      });
    }

    if (method === "POST") {
      const existing = notificationsByUser.get(body.recipientUserId) ?? [];
      if (state.injectConcurrentNotification) {
        state.injectConcurrentNotification = false;
        existing.push(notification("concurrent", "submission_concurrent"));
      }
      if (body.dedupeBySubmissionId) {
        const duplicate = existing.find(
          (item) =>
            item.type === body.type && item.submissionId === body.submissionId,
        );
        if (duplicate) return response({ notification: duplicate }, 201);
      }
      const created: AppNotification = {
        id: `ntf_${existing.length + 1}`,
        recipientUserId: body.recipientUserId,
        type: body.type,
        projectId: body.projectId,
        episodeId: body.episodeId,
        submissionId: body.submissionId,
        submitterUserId: body.submitterUserId,
        title: body.title,
        summary: body.summary,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      existing.push(created);
      notificationsByUser.set(body.recipientUserId, existing);
      return response({ notification: created }, 201);
    }

    if (method === "PATCH") {
      const existing = notificationsByUser.get(body.userId) ?? [];
      if (body.notificationId) {
        const current = existing.find((item) => item.id === body.notificationId);
        if (current && !current.readAt) current.readAt = new Date().toISOString();
        return response({ notification: current ?? null });
      }
      let changed = 0;
      for (const item of existing) {
        if (item.submissionId !== body.submissionId || item.readAt) continue;
        if (body.types && !body.types.includes(item.type)) continue;
        item.readAt = new Date().toISOString();
        changed += 1;
      }
      return response({ changed });
    }

    if (method === "DELETE") {
      const userId = url.searchParams.get("userId") ?? "";
      const notificationId = url.searchParams.get("notificationId") ?? "";
      const existing = notificationsByUser.get(userId) ?? [];
      const index = existing.findIndex((item) => item.id === notificationId);
      if (index < 0) {
        return response({ ok: false, code: "NOT_FOUND", message: "通知不存在" });
      }
      const current = existing[index]!;
      if (!current.readAt) {
        return response({ ok: false, code: "NOT_COMPLETED", message: "未完成的审批通知不可删除" });
      }
      existing.splice(index, 1);
      return response({ ok: true, notification: current });
    }

    return response({ error: "method not allowed" }, 405);
  }),
}));

import {
  countUnreadNotifications,
  createNotification,
  deleteNotification,
  listNotificationsForUser,
  markNotificationRead,
  markNotificationsReadBySubmission,
} from "@/notifications/store";

function notification(id: string, submissionId: string): AppNotification {
  return {
    id: `ntf_${id}`,
    recipientUserId: "user_1",
    type: "asset_approval_submitted",
    projectId: "project_1",
    episodeId: "episode_1",
    submissionId,
    submitterUserId: "submitter_1",
    title: id,
    summary: id,
    createdAt: "2026-08-01T00:00:00.000Z",
    readAt: null,
  };
}

function createInput(input?: {
  userId?: string;
  type?: NotificationType;
  submissionId?: string;
}) {
  return {
    recipientUserId: input?.userId ?? "user_1",
    type: input?.type ?? ("asset_approval_submitted" as const),
    projectId: "project_1",
    episodeId: "episode_1",
    submissionId: input?.submissionId ?? "submission_1",
    submitterUserId: "submitter_1",
    title: "title",
    summary: "summary",
  };
}

describe("remote notifications store", () => {
  beforeEach(() => {
    notificationsByUser.clear();
    state.injectConcurrentNotification = false;
  });

  it("creates, lists, and counts without local files", async () => {
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), "notifications-remote-"));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = isolatedRoot;
    const created = await createNotification(createInput());
    expect((await listNotificationsForUser("user_1"))[0]?.id).toBe(created.id);
    expect(await countUnreadNotifications("user_1")).toBe(1);
    expect(await readdir(isolatedRoot)).toEqual([]);
  });

  it("isolates notifications by recipient user", async () => {
    await createNotification(createInput({ userId: "user_1" }));
    await createNotification(createInput({ userId: "user_2" }));
    expect(await listNotificationsForUser("user_1")).toHaveLength(1);
    expect(await listNotificationsForUser("user_2")).toHaveLength(1);
  });

  it("deduplicates by notification type and submission", async () => {
    const input = { ...createInput(), dedupeBySubmissionId: true };
    const first = await createNotification(input);
    const duplicate = await createNotification(input);
    await createNotification({ ...input, type: "asset_approval_approved" });
    expect(duplicate.id).toBe(first.id);
    expect(await listNotificationsForUser("user_1")).toHaveLength(2);
  });

  it("marks one notification and matching submission types read", async () => {
    const first = await createNotification(createInput({ submissionId: "submission_1" }));
    await createNotification(createInput({ type: "asset_approval_approved", submissionId: "submission_1" }));
    await createNotification(createInput({ submissionId: "submission_2" }));
    expect((await markNotificationRead({ userId: "user_1", notificationId: first.id }))?.readAt).toBeTruthy();
    expect(await markNotificationsReadBySubmission({ userId: "user_1", submissionId: "submission_1", types: ["asset_approval_approved"] })).toBe(1);
    expect(await countUnreadNotifications("user_1")).toBe(1);
  });

  it("only deletes completed notifications", async () => {
    const created = await createNotification(createInput());
    expect(await deleteNotification({ userId: "user_1", notificationId: created.id })).toMatchObject({ ok: false, code: "NOT_COMPLETED" });
    await markNotificationRead({ userId: "user_1", notificationId: created.id });
    expect(await deleteNotification({ userId: "user_1", notificationId: created.id })).toMatchObject({ ok: true });
    expect(await listNotificationsForUser("user_1")).toEqual([]);
  });

  it("preserves notifications added concurrently by the Go service", async () => {
    state.injectConcurrentNotification = true;
    await createNotification(createInput({ submissionId: "submission_created" }));
    const notifications = await listNotificationsForUser("user_1");
    expect(notifications.map((item) => item.submissionId).sort()).toEqual(["submission_concurrent", "submission_created"]);
  });
});