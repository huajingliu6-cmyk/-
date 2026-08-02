import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { updateUserPassword } from "@/auth/users";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function PATCH(request: Request) {
  const auth = await requireSessionUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword =
      typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (confirmPassword && confirmPassword !== newPassword) {
      return NextResponse.json(
        { error: "两次输入的新密码不一致" },
        { status: 400 },
      );
    }

    const user = await updateUserPassword(auth.user.id, {
      currentPassword,
      newPassword,
    });
    return NextResponse.json({ user, notice: "密码已更新" });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message =
      error instanceof Error ? error.message : "修改密码失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
