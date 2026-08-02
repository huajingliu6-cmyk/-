import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { deleteNotification } from "@/notifications/store";
import { guardNotificationRemoteData } from "@/notifications/route-remote-guard";

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

/** Delete a completed (read) notification from the current user's inbox. */
export async function DELETE(_request: Request, context: RouteContext) {
  const { notificationId } = await context.params;
  const user = await requireSessionUser();
  if (!user.ok) return user.response;

  const guardedResult = await guardNotificationRemoteData(() =>
    deleteNotification({ userId: user.user.id, notificationId }),
  );
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }
  return NextResponse.json({ ok: true, notification: result.notification });
}
