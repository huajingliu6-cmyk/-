import { NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/auth/session";
import { authenticateUser, ensureAdminUser } from "@/auth/users";

export async function POST(request: Request) {
  try {
    await ensureAdminUser();
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "请输入用户名和密码" },
        { status: 400 },
      );
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    const token = await createSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    });

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "登录失败，请稍后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
