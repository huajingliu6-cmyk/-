import { describe, expect, it } from "vitest";
import { AUTH_NAV_ITEMS } from "@/shell/nav";
import { navigationForSpace } from "@/shell/space-navigation";

describe("space navigation", () => {
  it("shows only personal creation controls in personal space", () => {
    expect(navigationForSpace({ kind: "personal" }, null).map((item) => item.id)).toEqual([
      "projects",
      "materials",
      "guide",
    ]);
  });

  it("keeps system admin nav in personal space when allowed", () => {
    expect(
      navigationForSpace({ kind: "personal" }, AUTH_NAV_ITEMS).map((item) => item.id),
    ).toEqual(["projects", "materials", "guide", "admin-materials", "admin"]);
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

  it("shows system admin in enterprise navigation when included", () => {
    expect(
      navigationForSpace(
        { kind: "enterprise", enterpriseId: "enterprise-1" },
        AUTH_NAV_ITEMS,
      ).some((item) => item.id === "admin"),
    ).toBe(true);
  });
});
