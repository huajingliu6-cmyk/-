/** Minimal persistent in-app notifications (per recipient user). */

export type NotificationType =
  | "asset_approval_submitted"
  | "asset_approval_approved"
  | "asset_approval_rejected"
  | "enterprise_join_approved"
  | "enterprise_join_rejected";

export type AppNotification = {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  projectId: string;
  episodeId: string;
  submissionId: string;
  submitterUserId: string;
  enterpriseId?: string;
  title: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsFile = {
  version: 1;
  notifications: AppNotification[];
};
