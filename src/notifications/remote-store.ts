import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { AppNotification, NotificationType } from "@/notifications/types";

export type DeleteNotificationResult =
  | { ok: true; notification: AppNotification }
  | { ok: false; code: "NOT_FOUND" | "NOT_COMPLETED"; message: string };

type NotificationListResponse = {
  notifications: AppNotification[];
  unreadCount: number;
};

type NotificationResponse = { notification: AppNotification | null };

async function notificationRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_NOTIFICATION_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export function listNotificationsRemote(userId: string) {
  return notificationRequest<NotificationListResponse>(
    `/v1/notifications?userId=${encodeURIComponent(userId)}`,
  );
}

export async function createNotificationRemote(input: {
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
  const result = await notificationRequest<NotificationResponse>(
    "/v1/notifications",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!result.notification) throw new Error("REMOTE_NOTIFICATION_CREATE_EMPTY");
  return result.notification;
}

export async function markNotificationReadRemote(input: {
  userId: string;
  notificationId: string;
}): Promise<AppNotification | null> {
  const result = await notificationRequest<NotificationResponse>(
    "/v1/notifications",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.notification;
}

export async function markNotificationsReadBySubmissionRemote(input: {
  userId: string;
  submissionId: string;
  types?: NotificationType[];
}): Promise<number> {
  const result = await notificationRequest<{ changed: number }>(
    "/v1/notifications",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.changed;
}

export function deleteNotificationRemote(input: {
  userId: string;
  notificationId: string;
}): Promise<DeleteNotificationResult> {
  return notificationRequest<DeleteNotificationResult>(
    `/v1/notifications?userId=${encodeURIComponent(input.userId)}&notificationId=${encodeURIComponent(input.notificationId)}`,
    { method: "DELETE" },
  );
}
export async function loadRemoteNotificationsDocument(userId: string) {
  const result = await notificationRequest<{
    file: { version: 1; notifications: AppNotification[] };
    revision: number;
  }>(
    `/v1/notifications?userId=${encodeURIComponent(userId)}&snapshot=true`,
  );
  return {
    value: result.file,
    revision: result.revision,
  };
}

export function notificationsRemoteIdentity(userId: string) {
  return { namespace: "notifications", key: userId };
}
