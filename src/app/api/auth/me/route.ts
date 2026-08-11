import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/auth/session";
import { getUserById } from "@/auth/users";
import { isActiveSession } from "@/auth/session-registry";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    const session = await verifySessionToken(token);
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    if (!(await isActiveSession(session.userId, session.sessionId))) {
      const response = NextResponse.json(
        {
          error:
            "\u8d26\u53f7\u5df2\u5728\u5176\u4ed6\u8bbe\u5907\u767b\u5f55\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55",
        },
        { status: 401 },
      );
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return response;
    }
    const user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message =
      error instanceof Error ? error.message : "获取登录状态失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
