import { describe, expect, it } from "vitest";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";

describe("getScriptEpisodeContentFingerprint", () => {
  it("hashes number title and content only", () => {
    const a = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "初遇",
      content: "正文A",
    });
    const b = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "初遇",
      content: "正文A",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes CRLF to LF", () => {
    const lf = getScriptEpisodeContentFingerprint({
      episodeNumber: 2,
      title: "标题",
      content: "行1\n行2",
    });
    const crlf = getScriptEpisodeContentFingerprint({
      episodeNumber: 2,
      title: "标题",
      content: "行1\r\n行2",
    });
    expect(lf).toBe(crlf);
  });

  it("changes when episode number title or content changes", () => {
    const base = getScriptEpisodeContentFingerprint({
      episodeNumber: 1,
      title: "A",
      content: "B",
    });
    expect(
      getScriptEpisodeContentFingerprint({
        episodeNumber: 2,
        title: "A",
        content: "B",
      }),
    ).not.toBe(base);
    expect(
      getScriptEpisodeContentFingerprint({
        episodeNumber: 1,
        title: "C",
        content: "B",
      }),
    ).not.toBe(base);
    expect(
      getScriptEpisodeContentFingerprint({
        episodeNumber: 1,
        title: "A",
        content: "D",
      }),
    ).not.toBe(base);
  });
});
