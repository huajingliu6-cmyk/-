import { describe, expect, it } from "vitest";
import { AUTH_NAV_ITEMS } from "@/shell/nav";
import { navigationForSpace } from "@/shell/space-navigation";

describe("space navigation", () => {
  it("shows only personal creation controls in personal space", () => {
    expect(navigationForSpace({ kind: "personal" }, AUTH_NAV_ITEMS).map((item) => item.id)).toEqual([
      "projects",
      "showcase",
      "guide",
    ]);
  });

  it("uses the permission-filtered navigation in enterprise space", () => {
    const allowed = AUTH_NAV_ITEMS.filter((item) => ["workspace", "team"].includes(item.id));
    expect(navigationForSpace({ kind: "enterprise", enterpriseId: "enterprise-1" }, allowed).map((item) => item.id)).toEqual([
      "workspace",
      "team",
    ]);
  });

  it("does not flash enterprise controls before permissions load", () => {
    expect(navigationForSpace({ kind: "enterprise", enterpriseId: "enterprise-1" }, null)).toEqual([]);
  });
});
