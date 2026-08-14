import { describe, expect, it } from "vitest";
import {
  appendGeneratedMediaGeneration,
  appendGeneratedMediaGenerations,
  mergeGeneratedMediaState,
  mergeMediaIdLists,
  mergePromptHistories,
} from "@/projects/assets/episode-design/generated-media-history";

describe("generated media history is append-only", () => {
  it("never drops prior media ids when merging", () => {
    const merged = mergeMediaIdLists(
      ["gen_a", "gen_b"],
      ["gen_b", "gen_c"],
      ["gen_a"],
    );
    expect(merged).toEqual(["gen_a", "gen_b", "gen_c"]);
  });

  it("appendGeneratedMediaGeneration keeps previous images", () => {
    const first = appendGeneratedMediaGeneration(undefined, {
      mediaId: "gen_1",
      prompt: "第一版",
      generatedAt: "2026-01-01T00:00:00.000Z",
      promptFingerprint: "fp1",
      mimeType: "image/png",
    });
    const second = appendGeneratedMediaGeneration(first, {
      mediaId: "gen_2",
      prompt: "第二版",
      generatedAt: "2026-01-02T00:00:00.000Z",
      promptFingerprint: "fp2",
      mimeType: "image/png",
    });
    expect(second.currentId).toBe("gen_2");
    expect(second.historyIds).toEqual(["gen_1", "gen_2"]);
    expect(second.history?.map((h) => h.mediaId)).toEqual(["gen_1", "gen_2"]);
    expect(second.history?.[0]?.prompt).toBe("第一版");
  });

  it("appendGeneratedMediaGenerations sets currentId to first of batch", () => {
    const prev = appendGeneratedMediaGeneration(undefined, {
      mediaId: "old",
      prompt: "旧图",
      generatedAt: "t0",
      promptFingerprint: "fp0",
      mimeType: "image/png",
    });
    const batch = appendGeneratedMediaGenerations(prev, [
      {
        mediaId: "gen_a",
        prompt: "一批",
        generatedAt: "t1",
        promptFingerprint: "fp1",
        mimeType: "image/png",
      },
      {
        mediaId: "gen_b",
        prompt: "一批",
        generatedAt: "t1",
        promptFingerprint: "fp1",
        mimeType: "image/png",
      },
      {
        mediaId: "gen_c",
        prompt: "一批",
        generatedAt: "t1",
        promptFingerprint: "fp1",
        mimeType: "image/png",
      },
      {
        mediaId: "gen_d",
        prompt: "一批",
        generatedAt: "t1",
        promptFingerprint: "fp1",
        mimeType: "image/png",
      },
    ]);
    expect(batch.currentId).toBe("gen_a");
    expect(batch.historyIds).toEqual([
      "old",
      "gen_a",
      "gen_b",
      "gen_c",
      "gen_d",
    ]);
  });

  it("mergeGeneratedMediaState refuses to shrink history", () => {
    const rich = appendGeneratedMediaGeneration(
      appendGeneratedMediaGeneration(undefined, {
        mediaId: "gen_1",
        prompt: "a",
        generatedAt: "t1",
        promptFingerprint: "1",
      }),
      {
        mediaId: "gen_2",
        prompt: "b",
        generatedAt: "t2",
        promptFingerprint: "2",
      },
    );
    const stale = {
      currentId: "gen_2",
      historyIds: ["gen_2"],
      status: "completed" as const,
      promptFingerprint: "2",
      errorMessage: null,
      previewKind: "image" as const,
    };
    const merged = mergeGeneratedMediaState(rich, stale);
    expect(merged?.historyIds).toEqual(["gen_1", "gen_2"]);
  });

  it("mergePromptHistories keeps all distinct prompts", () => {
    const merged = mergePromptHistories(
      [
        {
          text: "提示A",
          generatedAt: "t1",
          generationId: null,
          source: "extract",
        },
      ],
      [
        {
          text: "提示B",
          generatedAt: "t2",
          generationId: null,
          source: "regenerate",
        },
      ],
    );
    expect(merged.map((p) => p.text)).toEqual(["提示A", "提示B"]);
  });
});
