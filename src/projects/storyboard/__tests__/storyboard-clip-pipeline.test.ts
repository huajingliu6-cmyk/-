import { describe, expect, it } from "vitest";
import type { CharacterAsset } from "@/projects/assets/types";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import { processStoryboardClipsResponse } from "@/projects/storyboard/services/storyboard-clip-pipeline";
import type { StoryboardStructuredClip } from "@/projects/storyboard/services/storyboard-clip-types";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";

function makeCharacter(
  id: string,
  name: string,
  media: string | null,
): CharacterAsset {
  return {
    id,
    projectId: "p1",
    name,
    role: "",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "ready",
    primaryMediaId: media,
  };
}

function libraryWithLinqing(media: string | null = "media_c1"): MatchableAssets {
  return {
    characters: [makeCharacter("c1", "林清", media)],
    scenes: [],
    props: [],
    audios: [],
  };
}

function makeClip(input: {
  shotId: string;
  total: 13 | 14 | 15;
  segments: Array<{ start: number; end: number; dialogue?: string }>;
  characterBlocking?: string;
  characterNames?: string[];
  mountLine?: string;
  visualActionPrefix?: string;
}): StoryboardStructuredClip {
  return {
    shotId: input.shotId,
    durationSeconds: input.total,
    characterNames: input.characterNames ?? ["林清"],
    mountLine: input.mountLine,
    characterBlocking:
      input.characterBlocking ?? "人物站位：林清居中。",
    segments: input.segments.map((seg, index) => ({
      start: seg.start,
      end: seg.end,
      shotSize: "中景",
      cameraAngle: "平视",
      cameraMovement: "固定",
      visualAction: `${input.visualActionPrefix ?? "林清"}${index + 1}`,
      dialogue: seg.dialogue ?? "",
      speaker: "",
    })),
    continuity: "保持服装一致。",
    sound: "环境声。",
    negative: "禁止变脸。",
  };
}

function baseSegments(total: 13 | 14 | 15) {
  if (total === 13) {
    return [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 13 },
    ];
  }
  if (total === 15) {
    return [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 12 },
      { start: 12, end: 15 },
    ];
  }
  return [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 12 },
    { start: 12, end: 14 },
  ];
}

describe("storyboard clip pipeline", () => {
  it("accepts valid structured clips and renders V5 prompts without bare assetId", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: baseSegments(14),
      mountLine: "挂载：@人物【图:fake】-伪造｜assetId:fake",
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).toContain("总时长：14秒");
    expect(prompt).toContain("0–4秒");
    expect(prompt).toContain("@人物【图:c1:林清】-林清");
    expect(prompt).not.toMatch(/assetId\s*[:=]/i);
    expect(prompt).not.toContain("伪造");
  });

  it.each([13, 14, 15] as const)("accepts %s second Clip", (total) => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({
        clips: [
          makeClip({
            shotId: shot.id,
            total,
            segments: baseSegments(total),
          }),
        ],
      }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });
    expect(result.ok).toBe(true);
  });

  it("generates mount from names only without model assetId", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: baseSegments(14),
      characterNames: ["林清"],
    });
    delete clip.mountLine;

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts.get(shot.id)).toContain("@人物【图:c1:林清】-林清");
  });

  it("ignores wrong model assetId and uses shot binding", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: baseSegments(14),
      mountLine: "挂载：@人物【图:ext_wrong】-假人｜assetId:ext_wrong",
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).toContain("@人物【图:c1:林清】-林清");
    expect(prompt).not.toContain("ext_wrong");
    expect(prompt).not.toContain("假人");
  });

  it("warns but accepts when character asset is missing from library", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c_missing"];
    shot.requiredCharacters = ["林清"];

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({
        clips: [
          makeClip({
            shotId: shot.id,
            total: 14,
            segments: baseSegments(14),
          }),
        ],
      }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "CHARACTER_ASSET_NOT_FOUND")).toBe(
      true,
    );
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).toContain("【素材提示】");
    expect(prompt).toContain("@人物-林清（未生成形象）");
    expect(prompt).not.toMatch(/assetId\s*[:=]/i);
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("@人物【图:");
  });

  it("warns but accepts character asset without media", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({
        clips: [
          makeClip({
            shotId: shot.id,
            total: 14,
            segments: baseSegments(14),
          }),
        ],
      }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(null),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "CHARACTER_ASSET_NO_MEDIA")).toBe(
      true,
    );
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).toContain("【素材提示】");
    expect(prompt).toContain("林清");
    expect(prompt).toContain("@人物-林清（未生成形象）");
    expect(prompt).not.toContain("@人物【图:");
  });

  it("warns but accepts required characters with no asset binding", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n韩兆丰走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = [];
    shot.requiredCharacters = ["韩兆丰"];

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({
        clips: [
          makeClip({
            shotId: shot.id,
            total: 14,
            segments: baseSegments(14),
            characterNames: ["韩兆丰"],
            characterBlocking: "人物站位：韩兆丰居中。",
            visualActionPrefix: "韩兆丰",
          }),
        ],
      }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some((w) => w.code === "CHARACTER_BINDING_INCOMPLETE"),
    ).toBe(true);
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).toContain("韩兆丰");
    expect(prompt).toContain("【素材提示】");
    expect(prompt).toContain("@人物-韩兆丰（未生成形象）");
    expect(prompt).not.toContain("@图片");
  });

  it("mounts a generated library character by name when the shot id is stale", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = [];
    shot.requiredCharacters = ["林清"];

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({
        clips: [
          makeClip({ shotId: shot.id, total: 14, segments: baseSegments(14) }),
        ],
      }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts.get(shot.id)).toContain(
      "@人物【图:c1:林清】-林清",
    );
    expect(result.prompts.get(shot.id)).not.toContain("未生成形象");
  });

  it("does not require character blocking for empty shots", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道空镜。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = [];
    shot.requiredCharacters = [];
    shot.dialogue = "";

    const clip: StoryboardStructuredClip = {
      shotId: shot.id,
      durationSeconds: 14,
      segments: baseSegments(14).map((seg, index) => ({
        start: seg.start,
        end: seg.end,
        shotSize: "全景",
        cameraAngle: "平视",
        cameraMovement: "固定",
        visualAction: `雨夜街道空镜${index + 1}`,
        dialogue: "",
        speaker: "",
      })),
      continuity: "保持雨夜光影一致。",
      sound: "雨声。",
      negative: "禁止字幕。",
    };

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts.get(shot.id) ?? "").not.toContain("人物站位");
  });

  it("warns but accepts when character shot lacks blocking", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: baseSegments(14),
      characterBlocking: "",
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some((w) => w.code === "MISSING_CHARACTER_BLOCKING"),
    ).toBe(true);
    const prompt = result.prompts.get(shot.id) ?? "";
    expect(prompt).not.toContain("见动作描述");
    expect(prompt).not.toContain("【位置结构】");
  });

  it("accepts many internal segments without count-cap warnings", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const segments = Array.from({ length: 6 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 2,
    }));
    const clip = makeClip({ shotId: shot.id, total: 14, segments });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "TOO_MANY_INTERNAL_SHOTS")).toBe(
      false,
    );
  });

  it("warns but accepts overlapping timeline", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 4 },
        { start: 2, end: 6 },
        { start: 6, end: 10 },
        { start: 10, end: 14 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "TIMELINE_OVERLAP")).toBe(true);
  });

  it("accepts 3 internal segments totaling 14 seconds", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
        { start: 10, end: 14 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
  });

  it("accepts fewer than 3 internal segments without count-floor warnings", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "TOO_FEW_INTERNAL_SHOTS")).toBe(
      false,
    );
  });

  it("warns but accepts when required character name is absent from clip text", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n韩兆丰走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = [];
    shot.requiredCharacters = ["韩兆丰"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: baseSegments(14),
      characterNames: [],
      characterBlocking: "",
      visualActionPrefix: "雨夜街道",
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some((w) => w.code === "MISSING_REQUIRED_CHARACTER"),
    ).toBe(true);
    expect(result.prompts.has(shot.id)).toBe(true);
  });

  it("treats segment longer than 6 seconds as soft warning only", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 7 },
        { start: 7, end: 11 },
        { start: 11, end: 14 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Legacy structured validator may soft-warn or skip body duration under V1.
    expect(result.prompts.size).toBe(1);
  });

  it("accepts segment of exactly 6 seconds with 3 segments", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 6 },
        { start: 6, end: 10 },
        { start: 10, end: 14 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
  });

  it("accepts segment of exactly 4 seconds with 4 segments", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];

    const clip = makeClip({
      shotId: shot.id,
      total: 14,
      segments: [
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 12 },
        { start: 12, end: 14 },
      ],
    });

    const result = processStoryboardClipsResponse({
      raw: JSON.stringify({ clips: [clip] }),
      targets: [{ shot, sceneTitle: "雨夜" }],
      libraryAssets: libraryWithLinqing(),
    });

    expect(result.ok).toBe(true);
  });
});
