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

  it("clears client session on logout before leaving /app", () => {
    const menu = readSrc("src/auth/AuthUserMenu.tsx");
    expect(menu).toContain("session?.applyUser(null)");
    expect(menu).toContain('credentials: "include"');
  });

  it("marks cookies Secure behind https proxies", () => {
    const httpsReq = new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(sessionCookieOptions(60, httpsReq).secure).toBe(true);

    const httpReq = new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "http" },
    });
    // In development without AUTH_COOKIE_SECURE, plain http stays non-secure
    if (process.env.NODE_ENV === "production") {
      expect(sessionCookieOptions(60, httpReq).secure).toBe(true);
    } else if (process.env.AUTH_COOKIE_SECURE === "true") {
      expect(sessionCookieOptions(60, httpReq).secure).toBe(true);
    } else {
      expect(sessionCookieOptions(60, httpReq).secure).toBe(false);
    }
  });

  it("login and register pass request into cookie options", () => {
    const login = readSrc("src/app/api/auth/login/route.ts");
    const register = readSrc("src/app/api/auth/register/route.ts");
    expect(login).toContain("sessionCookieOptions(undefined, request)");
    expect(register).toContain("sessionCookieOptions(undefined, request)");
  });
});
