import { describe, expect, it } from "vitest";
import {
  buildLocalProposedEpisodes,
  LOCAL_SPLIT_TARGET_CHARS_PER_EPISODE,
} from "@/projects/script/local-script-split";
import { episodeContentFingerprint } from "@/projects/script/script-split-reconstruct";

describe("buildLocalProposedEpisodes", () => {
  it("splits by explicit episode titles", () => {
    const source = [
      "第1集：开端",
      "甲乙对话。",
      "",
      "第2集：冲突",
      "冲突升级。",
      "",
      "第3集：收束",
      "终局。",
    ].join("\n");
    const result = buildLocalProposedEpisodes(source);
    expect(result.mode).toBe("title");
    expect(result.proposedEpisodes).toHaveLength(3);
    expect(result.proposedEpisodes.map((e) => e.episodeNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(result.proposedEpisodes[0]?.text).toContain("甲乙对话");
    expect(result.proposedEpisodes[1]?.text).toContain("冲突升级");
    expect(result.proposedEpisodes[0]?.contentFingerprint).toBe(
      episodeContentFingerprint(result.proposedEpisodes[0]!.text),
    );
  });

  it("falls back to block chunking when no titles and text is long", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      `段落${i + 1}：${"正文内容".repeat(200)}`,
    );
    const source = paragraphs.join("\n\n");
    const result = buildLocalProposedEpisodes(source);
    expect(result.mode).toBe("blocks");
    expect(result.proposedEpisodes.length).toBeGreaterThan(1);
    const joined = result.proposedEpisodes.map((e) => e.text).join("\n\n");
    for (const p of paragraphs) {
      expect(joined).toContain(p.slice(0, 20));
    }
    expect(
      result.proposedEpisodes.every(
        (e) =>
          e.contentFingerprint === episodeContentFingerprint(e.text),
      ),
    ).toBe(true);
  });

  it("keeps a short untitled script as one episode", () => {
    const source = "一段很短的剧本正文，没有集标题。";
    const result = buildLocalProposedEpisodes(source);
    expect(result.mode).toBe("title");
    expect(result.proposedEpisodes).toHaveLength(1);
    expect(result.proposedEpisodes[0]?.text).toBe(source);
    expect(
      countApprox(result.proposedEpisodes[0]!.text),
    ).toBeLessThanOrEqual(LOCAL_SPLIT_TARGET_CHARS_PER_EPISODE);
  });
});

function countApprox(text: string): number {
  return [...text].filter((ch) => ch !== " " && ch !== "\n").length;
}
