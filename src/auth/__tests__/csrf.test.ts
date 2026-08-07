import { describe, expect, it } from "vitest";
import { assertSameOriginMutation } from "@/auth/csrf";

describe("assertSameOriginMutation", () => {
  it("allows GET without origin", () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "GET",
      headers: { host: "localhost:3000" },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it("allows same-origin POST", () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it("rejects cross-origin POST", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    const res = assertSameOriginMutation(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { code?: string };
    expect(body.code).toBe("CSRF_REJECTED");
  });

  it("allows LAN http Origin for temporary external testing", () => {
    const req = new Request("http://192.168.1.20:3000/api/auth/login", {
      method: "POST",
      headers: {
        host: "192.168.1.20:3000",
        origin: "http://192.168.1.20:3000",
      },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it("allows Cloudflare tunnel Origin when Host is local but X-Forwarded-Host matches", () => {
    const req = new Request("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "https://demo.trycloudflare.com",
        "x-forwarded-host": "demo.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });
});
