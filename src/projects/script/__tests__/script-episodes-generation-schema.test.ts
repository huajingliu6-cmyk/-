import { describe, expect, it } from "vitest";
import { parseScriptEpisodesGenerationOutput } from "@/projects/script/script-episodes-generation-schema";

describe("parseScriptEpisodesGenerationOutput", () => {
  const valid = {
    version: 1 as const,
    episodes: [{ number: 2, title: "初遇", content: "本集正式剧本正文。" }],
  };

  it("accepts pure JSON", () => {
    const r = parseScriptEpisodesGenerationOutput(JSON.stringify(valid), {
      expectedCount: 1,
      expectedEpisodeNumber: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.episodes[0]!.title).toBe("初遇");
  });

  it("accepts single json fence", () => {
    const raw = "```json\n" + JSON.stringify(valid) + "\n```";
    const r = parseScriptEpisodesGenerationOutput(raw, {
      expectedCount: 1,
      expectedEpisodeNumber: 2,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects leading prose", () => {
    const r = parseScriptEpisodesGenerationOutput(
      "如下：\n" + JSON.stringify(valid),
      { expectedCount: 1, expectedEpisodeNumber: 2 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_EPISODES_OUTPUT_INVALID");
  });

  it("rejects trailing prose", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify(valid) + "\n完",
      { expectedCount: 1, expectedEpisodeNumber: 2 },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects two JSON objects", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify(valid) + JSON.stringify(valid),
      { expectedCount: 1, expectedEpisodeNumber: 2 },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects JSON5 / comments", () => {
    const r = parseScriptEpisodesGenerationOutput(
      `{version:1,episodes:[{number:1,title:"a",content:"b"}]}`,
      { expectedCount: 1, expectedEpisodeNumber: 1 },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects empty episodes", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({ version: 1, episodes: [] }),
      { expectedCount: 1 },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects empty title/content", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({
        version: 1,
        episodes: [{ number: 1, title: "  ", content: "x" }],
      }),
      { expectedCount: 1, expectedEpisodeNumber: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_EPISODES_CONTENT_EMPTY");
  });

  it("rejects duplicate numbers", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({
        version: 1,
        episodes: [
          { number: 1, title: "a", content: "b" },
          { number: 1, title: "c", content: "d" },
        ],
      }),
      { expectedCount: 2 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_EPISODES_NUMBER_INVALID");
  });

  it("rejects count mismatch", () => {
    const r = parseScriptEpisodesGenerationOutput(JSON.stringify(valid), {
      expectedCount: 2,
      expectedEpisodeNumber: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_EPISODES_COUNT_MISMATCH");
  });

  it("rejects wrong episode number", () => {
    const r = parseScriptEpisodesGenerationOutput(JSON.stringify(valid), {
      expectedCount: 1,
      expectedEpisodeNumber: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_EPISODES_NUMBER_INVALID");
  });

  it("rejects overlong title", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({
        version: 1,
        episodes: [
          { number: 1, title: "x".repeat(81), content: "正文" },
        ],
      }),
      { expectedCount: 1, expectedEpisodeNumber: 1 },
    );
    expect(r.ok).toBe(false);
  });

  it("treats HTML as plain text content", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({
        version: 1,
        episodes: [
          {
            number: 1,
            title: "安全",
            content: "<script>alert(1)</script>普通文本",
          },
        ],
      }),
      { expectedCount: 1, expectedEpisodeNumber: 1 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.episodes[0]!.content).toContain("<script>");
    }
  });

  it("ignores model-provided internal ids via strict schema", () => {
    const r = parseScriptEpisodesGenerationOutput(
      JSON.stringify({
        version: 1,
        episodes: [
          {
            number: 1,
            title: "a",
            content: "b",
            id: "hack",
          },
        ],
      }),
      { expectedCount: 1, expectedEpisodeNumber: 1 },
    );
    expect(r.ok).toBe(false);
  });
});
