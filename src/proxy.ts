import { NextResponse, type NextRequest } from "next/server";
import { assertSameOriginMutation } from "@/auth/csrf";
import { SESSION_COOKIE, verifySessionToken } from "@/auth/session";

/** 欢迎首页公开；登录入口在首页右上角 */
const PUBLIC_PATHS = new Set(["/", "/login", "/build-revision"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (
    process.env.NODE_ENV === "development" &&
    (pathname === "/asset-fusion-preview" ||
      pathname === "/storyboard-layout-preview")
  ) {
    return true;
  }
  if (pathname.startsWith("/api/auth/")) return true;
  // 静态资源 + 非敏感构建标识（LAN 诊断）
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    pathname === "/favicon.ico" ||
    pathname === "/build-info.json"
  ) {
    return true;
  }
  return false;
}

function redirectToHomeLogin(request: NextRequest, nextPath?: string) {
  const homeUrl = new URL("/", request.url);
  homeUrl.searchParams.set("login", "1");
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    homeUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(homeUrl);
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 旧 /login 入口统一到首页右上角登录
  if (pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next") ?? undefined;
    return redirectToHomeLogin(request, next);
  }

  if (pathname.startsWith("/api/")) {
    const csrf = assertSameOriginMutation(request);
    if (csrf) return csrf;
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return withNoStore(
        NextResponse.json({ error: "未登录" }, { status: 401 }),
      );
    }
    return redirectToHomeLogin(request, pathname);
  }

  const session = await verifySessionToken(token);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      const response = withNoStore(
        NextResponse.json(
          { error: "登录已失效，请重新登录" },
          { status: 401 },
        ),
      );
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    const response = redirectToHomeLogin(request, pathname);
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const next = NextResponse.next();
  if (pathname.startsWith("/api/")) {
    next.headers.set("Cache-Control", "no-store");
  }
  return next;
}

export const config = {
  matcher: [
    /*
     * 匹配除静态文件外的路径
     */
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
