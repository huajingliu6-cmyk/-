import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { markNotificationRead } from "@/notifications/store";
import { guardNotificationRemoteData } from "@/notifications/route-remote-guard";

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { notificationId } = await context.params;
  const user = await requireSessionUser();
  if (!user.ok) return user.response;

  const guardedNote = await guardNotificationRemoteData(() =>
    markNotificationRead({ userId: user.user.id, notificationId }),
  );
  if (guardedNote instanceof NextResponse) return guardedNote;
  const note = guardedNote;
  if (!note) {
    return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  }
  return NextResponse.json({ notification: note });
}
