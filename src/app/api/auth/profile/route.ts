import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { updateUserProfile } from "@/auth/users";

export async function PATCH(request: Request) {
  const auth = await requireSessionUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { displayName?: string };
    const user = await updateUserProfile(auth.user.id, {
      displayName: body.displayName,
    });
    return NextResponse.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "更新资料失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
