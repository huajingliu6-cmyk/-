import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/auth/session";
import { getUserById } from "@/auth/users";
import type { AuthUser } from "@/auth/types";

export async function requireSessionUser(): Promise<
  { ok: true; user: AuthUser } | { ok: false; response: NextResponse }
> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "登录已失效" }, { status: 401 }),
    };
  }
  const user = await getUserById(session.userId);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "用户不存在" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

export async function requireAdminUser(): Promise<
  { ok: true; user: AuthUser } | { ok: false; response: NextResponse }
> {
  const session = await requireSessionUser();
  if (!session.ok) return session;
  if (session.user.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "需要管理员权限" }, { status: 403 }),
    };
  }
  return session;
}
