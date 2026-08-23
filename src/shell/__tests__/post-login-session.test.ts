import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { sessionCookieOptions } from "@/auth/session";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("post-login session handoff", () => {
  it("applies authenticated user before navigating into /app", () => {
    const home = readSrc("src/home/components/HomeChrome.tsx");
    const provider = readSrc("src/shell/AuthSessionProvider.tsx");
    expect(provider).toContain("applyUser");
    expect(provider).toContain("epochRef");
    expect(home).toContain("session?.applyUser(user)");
    expect(home).toContain("session?.refresh()");
  });

  it("defaults post-login landing to projects list, not blank portal", () => {
    const nav = readSrc("src/shell/nav.ts");
    const login = readSrc("src/home/components/HeaderLoginPanel.tsx");
    const hero = readSrc("src/home/components/HeroCta.tsx");
    expect(nav).toContain("APP_POST_LOGIN_PATH = APP_PROJECTS_PATH");
    expect(login).toContain("APP_POST_LOGIN_PATH");
    expect(login).not.toMatch(/:\s*"\/app";/);
    expect(hero).toContain("APP_POST_LOGIN_PATH");
    expect(hero).not.toContain('router.push("/app")');
  });

  it("clears client session on logout before leaving /app", () => {
    const menu = readSrc("src/auth/AuthUserMenu.tsx");
    expect(menu).toContain("session?.applyUser(null)");
    expect(menu).toContain('credentials: "include"');
  });

  it("marks cookies Secure behind https proxies, not plain http LAN", () => {
    const prev = process.env.AUTH_COOKIE_SECURE;
    delete process.env.AUTH_COOKIE_SECURE;
    try {
      const httpsReq = new Request("http://127.0.0.1:3000/api/auth/login", {
        headers: { "x-forwarded-proto": "https" },
      });
      expect(sessionCookieOptions(60, httpsReq).secure).toBe(true);

      const httpReq = new Request("http://192.168.31.105:3080/api/auth/login", {
        headers: { "x-forwarded-proto": "http" },
      });
      expect(sessionCookieOptions(60, httpReq).secure).toBe(false);

      const httpsUrlReq = new Request("https://example.com/api/auth/login");
      expect(sessionCookieOptions(60, httpsUrlReq).secure).toBe(true);

      process.env.AUTH_COOKIE_SECURE = "true";
      expect(sessionCookieOptions(60, httpReq).secure).toBe(true);
      process.env.AUTH_COOKIE_SECURE = "false";
      expect(sessionCookieOptions(60, httpsReq).secure).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = prev;
    }
  });

  it("login and register pass request into cookie options", () => {
    const login = readSrc("src/app/api/auth/login/route.ts");
    const register = readSrc("src/app/api/auth/register/route.ts");
    expect(login).toContain("sessionCookieOptions(undefined, request)");
    expect(register).toContain("sessionCookieOptions(undefined, request)");
  });
});
