import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/auth/session";
import { ensureAdminUser, getUserById } from "@/auth/users";

export async function GET() {
  try {
    await ensureAdminUser();
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    const session = await verifySessionToken(token);
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    const user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "获取登录状态失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
