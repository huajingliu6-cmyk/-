import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { updateUserProfile } from "@/auth/users";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

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
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message =
      error instanceof Error ? error.message : "更新资料失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
