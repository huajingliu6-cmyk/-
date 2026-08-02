import { describe, expect, it } from "vitest";
import {
  parseScriptSplitModelOutput,
  stripMarkdownCodeFence,
} from "@/projects/script/script-split-schema";
import { splitSourceTextIntoBlocks } from "@/projects/script/script-split-blocks";
import {
  episodeContentFingerprint,
  reconstructEpisodesFromBoundaries,
} from "@/projects/script/script-split-reconstruct";

describe("script split boundary core", () => {
  const source = "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.";
  const blocks = splitSourceTextIntoBlocks(source);

  it("splits source into numbered blocks", () => {
    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.id).toBe("B000001");
    expect(blocks[3]?.id).toBe("B000004");
    expect(blocks[0]?.text).toBe("Alpha block.");
  });

  it("falls back to single newlines when no paragraph breaks", () => {
    const single = splitSourceTextIntoBlocks("Line one\nLine two\n\n");
    expect(single.map((b) => b.text)).toEqual(["Line one", "Line two"]);
  });

  it("parse accepts json fence", () => {
    const payload = {
      episodes: [
        {
          episodeNumber: 1,
          title: "上",
          startBlockId: "B000001",
          endBlockId: "B000002",
        },
        {
          episodeNumber: 2,
          title: "下",
          startBlockId: "B000003",
          endBlockId: "B000004",
        },
      ],
    };
    const raw = "```json\n" + JSON.stringify(payload) + "\n```";
    expect(stripMarkdownCodeFence(raw)).toContain('"episodes"');
    const parsed = parseScriptSplitModelOutput(raw);
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown block id", () => {
    const parsed = parseScriptSplitModelOutput(
      JSON.stringify({
        episodes: [
          {
            episodeNumber: 1,
            title: "一",
            startBlockId: "B999999",
            endBlockId: "B999999",
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, parsed.value);
    expect(rebuilt.ok).toBe(false);
    if (rebuilt.ok) return;
    expect(rebuilt.code).toBe("SCRIPT_SPLIT_UNKNOWN_BLOCK");
  });

  it("rejects overlap", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "A",
          startBlockId: "B000001",
          endBlockId: "B000003",
        },
        {
          episodeNumber: 2,
          title: "B",
          startBlockId: "B000003",
          endBlockId: "B000004",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(false);
    if (rebuilt.ok) return;
    expect(rebuilt.code).toBe("SCRIPT_SPLIT_OVERLAP");
  });

  it("rejects gap", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "A",
          startBlockId: "B000001",
          endBlockId: "B000001",
        },
        {
          episodeNumber: 2,
          title: "B",
          startBlockId: "B000003",
          endBlockId: "B000004",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(false);
    if (rebuilt.ok) return;
    expect(rebuilt.code).toBe("SCRIPT_SPLIT_GAP");
  });

  it("rejects head uncovered", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "B",
          startBlockId: "B000002",
          endBlockId: "B000004",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(false);
    if (rebuilt.ok) return;
    expect(rebuilt.code).toBe("SCRIPT_SPLIT_HEAD_UNCOVERED");
  });

  it("rejects tail uncovered", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "A",
          startBlockId: "B000001",
          endBlockId: "B000003",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(false);
    if (rebuilt.ok) return;
    expect(rebuilt.code).toBe("SCRIPT_SPLIT_TAIL_UNCOVERED");
  });

  it("rejects duplicate episode numbers in model output", () => {
    const parsed = parseScriptSplitModelOutput(
      JSON.stringify({
        episodes: [
          {
            episodeNumber: 1,
            title: "A",
            startBlockId: "B000001",
            endBlockId: "B000001",
          },
          {
            episodeNumber: 1,
            title: "B",
            startBlockId: "B000002",
            endBlockId: "B000004",
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe("SCRIPT_SPLIT_NUMBER_INVALID");
    }
  });

  it("reconstruct uses block text not model rewrite", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "前半",
          startBlockId: "B000001",
          endBlockId: "B000002",
        },
        {
          episodeNumber: 2,
          title: "后半",
          startBlockId: "B000003",
          endBlockId: "B000004",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.episodes[0]?.text).toBe("Alpha block.\n\nBeta block.");
    expect(rebuilt.episodes[1]?.text).toBe("Gamma block.\n\nDelta block.");
    expect(rebuilt.episodes[0]?.contentFingerprint).toBe(
      episodeContentFingerprint(rebuilt.episodes[0]!.text),
    );
  });

  it("full coverage succeeds", () => {
    const boundaries = {
      episodes: [
        {
          episodeNumber: 1,
          title: "一",
          startBlockId: "B000001",
          endBlockId: "B000002",
        },
        {
          episodeNumber: 2,
          title: "二",
          startBlockId: "B000003",
          endBlockId: "B000004",
        },
      ],
    };
    const rebuilt = reconstructEpisodesFromBoundaries(blocks, boundaries);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const joined = rebuilt.episodes.map((e) => e.text).join("\n\n---\n\n");
    expect(joined).toContain("Alpha block.");
    expect(joined).toContain("Delta block.");
  });
});
