/** Minimal persistent in-app notifications (per recipient user). */

export type NotificationType =
  | "asset_approval_submitted"
  | "asset_approval_approved"
  | "asset_approval_rejected";

export type AppNotification = {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  projectId: string;
  episodeId: string;
  submissionId: string;
  submitterUserId: string;
  title: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsFile = {
  version: 1;
  notifications: AppNotification[];
};
