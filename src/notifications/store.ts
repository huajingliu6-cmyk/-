import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  createNotificationRemote,
  deleteNotificationRemote,
  listNotificationsRemote,
  markNotificationReadRemote,
  markNotificationsReadBySubmissionRemote,
  type DeleteNotificationResult,
} from "@/notifications/remote-store";
import type {
  AppNotification,
  NotificationType,
  NotificationsFile,
} from "@/notifications/types";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";

function notificationsRoot(): string {
  return resolveAppDataPath("notifications");
}

function userFile(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return path.join(notificationsRoot(), `${safe}.json`);
}

async function ensureRoot() {
  await fs.mkdir(notificationsRoot(), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNotification(raw: unknown): AppNotification | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.recipientUserId !== "string") {
    return null;
  }
  if (
    raw.type !== "asset_approval_submitted" &&
    raw.type !== "asset_approval_approved" &&
    raw.type !== "asset_approval_rejected" &&
    raw.type !== "enterprise_join_approved" &&
    raw.type !== "enterprise_join_rejected" &&
    raw.type !== "image_generation_succeeded" &&
    raw.type !== "image_generation_failed"
  ) {
    return null;
  }
  if (
    typeof raw.projectId !== "string" ||
    typeof raw.episodeId !== "string" ||
    typeof raw.submissionId !== "string" ||
    typeof raw.submitterUserId !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.summary !== "string" ||
    typeof raw.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    recipientUserId: raw.recipientUserId,
    type: raw.type,
    projectId: raw.projectId,
    episodeId: raw.episodeId,
    submissionId: raw.submissionId,
    submitterUserId: raw.submitterUserId,
    enterpriseId:
      typeof raw.enterpriseId === "string" ? raw.enterpriseId : undefined,
    title: raw.title,
    summary: raw.summary,
    createdAt: raw.createdAt,
    readAt: typeof raw.readAt === "string" ? raw.readAt : null,
  };
}

export function normalizeNotificationsFile(raw: unknown): NotificationsFile {
  if (!isRecord(raw) || !Array.isArray(raw.notifications)) {
    return { version: 1, notifications: [] };
  }
  return {
    version: 1,
    notifications: raw.notifications
      .map(parseNotification)
      .filter((notification): notification is AppNotification =>
        notification != null,
      ),
  };
}

async function readLocalFile(userId: string): Promise<NotificationsFile> {
  await ensureRoot();
  try {
    return normalizeNotificationsFile(
      JSON.parse(await fs.readFile(userFile(userId), "utf-8")) as unknown,
    );
  } catch {
    return { version: 1, notifications: [] };
  }
}

async function writeLocalFile(
  userId: string,
  data: NotificationsFile,
): Promise<void> {
  await ensureRoot();
  const file = userFile(userId);
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(temporaryFile, file);
}

export async function listNotificationsForUser(
  userId: string,
): Promise<AppNotification[]> {
  if (isRemoteDataOnly()) {
    return (await listNotificationsRemote(userId)).notifications;
  }
  const file = await readLocalFile(userId);
  return [...file.notifications].sort((left, right) =>
    left.createdAt < right.createdAt
      ? 1
      : left.createdAt > right.createdAt
        ? -1
        : 0,
  );
}

export async function countUnreadNotifications(
  userId: string,
): Promise<number> {
  if (isRemoteDataOnly()) {
    return (await listNotificationsRemote(userId)).unreadCount;
  }
  return (await listNotificationsForUser(userId)).filter(
    (notification) => !notification.readAt,
  ).length;
}

export async function createNotification(input: {
  recipientUserId: string;
  type: NotificationType;
  projectId: string;
  episodeId: string;
  submissionId: string;
  submitterUserId: string;
  enterpriseId?: string;
  title: string;
  summary: string;
  dedupeBySubmissionId?: boolean;
}): Promise<AppNotification> {
  if (isRemoteDataOnly()) return createNotificationRemote(input);
  const file = await readLocalFile(input.recipientUserId);
  if (input.dedupeBySubmissionId) {
    const existing = file.notifications.find(
      (notification) =>
        notification.type === input.type &&
        notification.submissionId === input.submissionId,
    );
    if (existing) return existing;
  }
  const notification: AppNotification = {
    id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    recipientUserId: input.recipientUserId,
    type: input.type,
    projectId: input.projectId,
    episodeId: input.episodeId,
    submissionId: input.submissionId,
    submitterUserId: input.submitterUserId,
    enterpriseId: input.enterpriseId,
    title: input.title,
    summary: input.summary,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  file.notifications.push(notification);
  await writeLocalFile(input.recipientUserId, file);
  return notification;
}

export async function markNotificationRead(input: {
  userId: string;
  notificationId: string;
}): Promise<AppNotification | null> {
  if (isRemoteDataOnly()) return markNotificationReadRemote(input);
  const file = await readLocalFile(input.userId);
  const index = file.notifications.findIndex(
    (notification) => notification.id === input.notificationId,
  );
  if (index < 0) return null;
  const current = file.notifications[index]!;
  if (current.readAt) return current;
  const next = { ...current, readAt: new Date().toISOString() };
  file.notifications[index] = next;
  await writeLocalFile(input.userId, file);
  return next;
}

export async function markNotificationsReadBySubmission(input: {
  userId: string;
  submissionId: string;
  types?: NotificationType[];
}): Promise<number> {
  if (isRemoteDataOnly()) {
    return markNotificationsReadBySubmissionRemote(input);
  }
  const file = await readLocalFile(input.userId);
  const now = new Date().toISOString();
  let changed = 0;
  file.notifications = file.notifications.map((notification) => {
    if (notification.submissionId !== input.submissionId) return notification;
    if (input.types && !input.types.includes(notification.type)) {
      return notification;
    }
    if (notification.readAt) return notification;
    changed += 1;
    return { ...notification, readAt: now };
  });
  if (changed > 0) await writeLocalFile(input.userId, file);
  return changed;
}

export async function deleteNotification(input: {
  userId: string;
  notificationId: string;
}): Promise<DeleteNotificationResult> {
  if (isRemoteDataOnly()) return deleteNotificationRemote(input);
  const file = await readLocalFile(input.userId);
  const index = file.notifications.findIndex(
    (notification) => notification.id === input.notificationId,
  );
  if (index < 0) {
    return { ok: false, code: "NOT_FOUND", message: "通知不存在" };
  }
  const current = file.notifications[index]!;
  if (!current.readAt) {
    return {
      ok: false,
      code: "NOT_COMPLETED",
      message: "未完成的审批通知不可删除",
    };
  }
  file.notifications.splice(index, 1);
  await writeLocalFile(input.userId, file);
  return { ok: true, notification: current };
}
