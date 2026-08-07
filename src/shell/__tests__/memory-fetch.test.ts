import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearMemoryFetchInflight,
  memoryFetch,
} from "@/shell/memory-fetch";

describe("memoryFetch", () => {
  beforeEach(() => {
    clearMemoryFetchInflight();
    vi.restoreAllMocks();
  });

  it("coalesces identical in-flight GET requests", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const [a, b] = await Promise.all([
      memoryFetch("/api/auth/navigation"),
      memoryFetch("/api/auth/navigation"),
    ]);
    expect(calls).toBe(1);
    expect(await a.json()).toEqual({ ok: true });
    expect(await b.json()).toEqual({ ok: true });
  });

  it("does not coalesce POST requests", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      }),
    );
    await Promise.all([
      memoryFetch("/api/x", { method: "POST", body: "{}" }),
      memoryFetch("/api/x", { method: "POST", body: "{}" }),
    ]);
    expect(calls).toBe(2);
  });

  it("caller abort does not cancel the shared GET for a remounted waiter", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 40));
        return new Response(
          JSON.stringify({
            navigation: [
              { id: "projects", label: "项目管理", href: "/app/projects" },
              { id: "workspace", label: "工作台", href: "/app/workspace" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const first = new AbortController();
    const firstWait = memoryFetch("/api/auth/navigation", {
      signal: first.signal,
    });
    first.abort();
    await expect(firstWait).rejects.toMatchObject({ name: "AbortError" });

    const second = await memoryFetch("/api/auth/navigation", {
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    const payload = (await second.json()) as {
      navigation: Array<{ id: string }>;
    };
    expect(payload.navigation.map((item) => item.id)).toEqual([
      "projects",
      "workspace",
    ]);
  });
});
