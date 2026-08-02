import { describe, expect, it } from "vitest";
import {
  filterShotMentionAssets,
  getActiveShotMentionQuery,
} from "@/projects/storyboard/components/ShotPromptEditor";

describe("shot prompt @ mention filter", () => {
  const assets = [
    { id: "c1", name: "江宸", kind: "character" as const, thumbUrl: "/a.png" },
    { id: "c2", name: "苏晚璃", kind: "character" as const, thumbUrl: null },
    {
      id: "s1",
      name: "诡市第九号当铺人事办公室",
      kind: "scene" as const,
      thumbUrl: "/s.png",
    },
    { id: "p1", name: "红色契约纸", kind: "prop" as const, thumbUrl: null },
  ];

  it("returns all shot assets when query empty", () => {
    expect(filterShotMentionAssets(assets, "").map((a) => a.id)).toEqual([
      "c1",
      "c2",
      "s1",
      "p1",
    ]);
  });

  it("filters by name", () => {
    expect(filterShotMentionAssets(assets, "江").map((a) => a.id)).toEqual([
      "c1",
    ]);
  });

  it("filters by kind label", () => {
    expect(filterShotMentionAssets(assets, "场景").map((a) => a.id)).toEqual([
      "s1",
    ]);
  });
});

describe("getActiveShotMentionQuery", () => {
  it("triggers after CJK without requiring whitespace", () => {
    const text = "镜头中@";
    expect(getActiveShotMentionQuery(text, text.length)).toEqual({
      start: 3,
      query: "",
    });
  });

  it("supports fullwidth at-sign", () => {
    const text = "开场＠江";
    expect(getActiveShotMentionQuery(text, text.length)).toEqual({
      start: 2,
      query: "江",
    });
  });

  it("blocks email-like ascii prefix", () => {
    expect(getActiveShotMentionQuery("a@b", 3)).toBeNull();
  });

  it("allows at line start", () => {
    expect(getActiveShotMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("stops after whitespace in query", () => {
    expect(getActiveShotMentionQuery("@江 宸", 4)).toBeNull();
  });
});
