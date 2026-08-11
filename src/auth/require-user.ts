import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/auth/session";
import { getUserById } from "@/auth/users";
import type { AuthUser } from "@/auth/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import { isActiveSession } from "@/auth/session-registry";

function replacedSessionResponse(): NextResponse {
  const response = NextResponse.json(
    {
      error:
        "\u8d26\u53f7\u5df2\u5728\u5176\u4ed6\u8bbe\u5907\u767b\u5f55\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55",
    },
    { status: 401 },
  );
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}

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
  let user;
  try {
    const active = await isActiveSession(session.userId, session.sessionId);
    if (!active) {
      return {
        ok: false,
        response: replacedSessionResponse(),
      };
    }
    user = await getUserById(session.userId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "内网数据服务不可用" },
          { status: 503 },
        ),
      };
    }
    throw error;
  }
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
