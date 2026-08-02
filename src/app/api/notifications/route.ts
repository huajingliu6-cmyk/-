import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  countUnreadNotifications,
  listNotificationsForUser,
} from "@/notifications/store";
import { guardNotificationRemoteData } from "@/notifications/route-remote-guard";

export async function GET() {
  const user = await requireSessionUser();
  if (!user.ok) return user.response;

  const guardedNotifications = await guardNotificationRemoteData(() =>
    Promise.all([
      listNotificationsForUser(user.user.id),
      countUnreadNotifications(user.user.id),
    ]),
  );
  if (guardedNotifications instanceof NextResponse) return guardedNotifications;
  const [notifications, unreadCount] = guardedNotifications;
  return NextResponse.json({ notifications, unreadCount });
}
