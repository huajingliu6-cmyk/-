import { describe, expect, it } from "vitest";
import {
  assertEpisodeAssetDesignBriefIsolation,
  assertSafeEpisodeAssetDesignRequest,
  buildEpisodeAssetDesignGenerationRequest,
  buildEpisodeAssetDesignProviderBrief,
} from "@/projects/assets/episode-design/prompts";

describe("episode asset design prompt isolation", () => {
  it("provider brief contains only current episode fields", () => {
    const body = buildEpisodeAssetDesignGenerationRequest({
      projectId: "p1",
      episodeId: "ep1",
      episodeNumber: 2,
      title: "初遇",
      content: "仅本集正文。",
      modelKey: "balanced-default",
      targetChars: 800,
      idempotencyKey: "k1",
    });
    const brief = buildEpisodeAssetDesignProviderBrief(body);
    expect(brief).toContain("第2集");
    expect(brief).toContain("初遇");
    expect(brief).toContain("仅本集正文。");
    expect(brief).not.toContain("sourceText");
    expect(brief).not.toContain("【已保存剧本大纲】");
  });

  it("assertSafe rejects empty content", () => {
    const body = buildEpisodeAssetDesignGenerationRequest({
      projectId: "p1",
      episodeId: "ep1",
      episodeNumber: 1,
      title: "T",
      content: "   ",
      modelKey: "balanced-default",
      targetChars: 800,
      idempotencyKey: "k1",
    });
    expect(() => assertSafeEpisodeAssetDesignRequest(body)).toThrow(/正文/);
  });

  it("assertEpisodeAssetDesignBriefIsolation rejects forbidden snippets", () => {
    const brief = buildEpisodeAssetDesignProviderBrief({
      episodeNumber: 1,
      title: "A",
      content: "B",
      targetChars: 500,
    });
    expect(() =>
      assertEpisodeAssetDesignBriefIsolation(brief, ["其他集泄露正文"]),
    ).not.toThrow();
    expect(() =>
      assertEpisodeAssetDesignBriefIsolation("含 sourceText 泄漏", []),
    ).toThrow();
  });
});
