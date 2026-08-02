import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("notifications-poller anti-storm", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const g = globalThis as typeof globalThis & {
      __ic_notifications_poller_v2__?: unknown;
    };
    delete g.__ic_notifications_poller_v2__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("短窗口内多次 subscribe / refresh 只打一次网", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ notifications: [], unreadCount: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { subscribeNotifications, refreshNotifications } = await import(
      "@/shell/notifications-poller"
    );

    const unsub1 = subscribeNotifications(() => undefined);
    const unsub2 = subscribeNotifications(() => undefined);
    await refreshNotifications();
    await refreshNotifications();
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    unsub1();
    unsub2();
  });
});
