import { describe, expect, it } from "vitest";
import {
  buildCanonicalScriptSourceText,
  canonicalEpisodesRoundTripEquivalent,
} from "@/projects/script/build-canonical-script-source-text";

describe("buildCanonicalScriptSourceText", () => {
  it("builds stable ordered sourceText", () => {
    const text = buildCanonicalScriptSourceText([
      { episodeNumber: 2, title: "转折", content: "第二集正文" },
      { episodeNumber: 1, title: "初遇", content: "第一集正文" },
    ]);
    expect(text).toBe(
      "第1集：初遇\n\n第一集正文\n\n第2集：转折\n\n第二集正文",
    );
  });

  it("does not duplicate episode label in title", () => {
    const text = buildCanonicalScriptSourceText([
      { episodeNumber: 1, title: "第1集：开场", content: "正文" },
    ]);
    expect(text.startsWith("第1集：开场")).toBe(true);
    expect(text).not.toMatch(/第1集：第1集/);
  });

  it("is deterministic for same semantics", () => {
    const a = buildCanonicalScriptSourceText([
      { episodeNumber: 1, title: "A", content: "x\ny" },
    ]);
    const b = buildCanonicalScriptSourceText([
      { episodeNumber: 1, title: "A", content: "x\ny" },
    ]);
    expect(a).toBe(b);
  });

  it("round-trips through unified parser", () => {
    expect(
      canonicalEpisodesRoundTripEquivalent([
        { episodeNumber: 1, title: "初遇", content: "中文正文一行" },
        { episodeNumber: 2, title: "Hello", content: "English body" },
      ]),
    ).toBe(true);
  });

  it("does not embed ids or generation metadata", () => {
    const text = buildCanonicalScriptSourceText([
      { episodeNumber: 1, title: "t", content: "c" },
    ]);
    expect(text).not.toMatch(/ep_|generation|profile|importedAt/i);
  });
});
