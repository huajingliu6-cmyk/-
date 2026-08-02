import { describe, expect, it } from "vitest";
import {
  applyShotPromptAssetMount,
  buildMountLine,
  normalizePromptImageTokensForSubmit,
  parsePromptImageSegments,
  replaceAssetNamesWithImageTokens,
  upsertMountLine,
} from "@/projects/storyboard/services/shot-prompt-mount";

describe("shot-prompt-mount", () => {
  const assets = [
    {
      id: "c1",
      kind: "character" as const,
      name: "江宸",
      imageUrl: "/img/jc.png",
    },
    {
      id: "c2",
      kind: "character" as const,
      name: "苏晚璃",
      imageUrl: "/img/swl.png",
    },
    {
      id: "s1",
      kind: "scene" as const,
      name: "诡市第九号当铺人事办公室",
      imageUrl: "/img/office.png",
    },
    {
      id: "p1",
      kind: "prop" as const,
      name: "红色契约纸",
      imageUrl: "/img/paper.png",
    },
  ];

  it("builds mount line as @人物【图】-名 / @场景【图】-名", () => {
    expect(buildMountLine(assets)).toBe(
      "挂载：@人物【图:c1:江宸】-江宸｜@人物【图:c2:苏晚璃】-苏晚璃｜@场景【图:s1:诡市第九号当铺人事办公室】-诡市第九号当铺人事办公室｜@道具【图:p1:红色契约纸】-红色契约纸",
    );
  });

  it("falls back to @tags on mount line when no imageUrl", () => {
    expect(
      buildMountLine([
        { id: "c1", kind: "character", name: "江宸", imageUrl: null },
        { id: "s1", kind: "scene", name: "办公室", imageUrl: null },
      ]),
    ).toBe("挂载：@人物-江宸｜@场景-办公室");
  });

  it("inserts mount line after shot header", () => {
    const prompt = `[分镜01｜总时长：3秒｜画幅：9:16]
场景基调：暗沉办公室。`;
    const next = upsertMountLine(prompt, "挂载：@人物-江宸｜@场景-办公室");
    expect(next).toBe(
      `[分镜01｜总时长：3秒｜画幅：9:16]
挂载：@人物-江宸｜@场景-办公室
场景基调：暗沉办公室。`,
    );
  });

  it("replaces bare names and upgrades @tags to @人物【图】-名", () => {
    const text =
      "江宸坐在桌边，@人物-苏晚璃走进诡市第九号当铺人事办公室，拿起红色契约纸。";
    const { text: next } = replaceAssetNamesWithImageTokens(text, assets);
    expect(next).toContain("【图:c1:江宸】坐在桌边");
    expect(next).toContain("@人物【图:c2:苏晚璃】-苏晚璃");
    expect(next).toContain("【图:s1:诡市第九号当铺人事办公室】");
    expect(next).toContain("【图:p1:红色契约纸】");
    expect(next).not.toContain("@人物-苏晚璃");
  });

  it("parses @人物【图】-名 for preview as text + thumb + text", () => {
    const segs = parsePromptImageSegments(
      "挂载：@人物【图:c1:江宸】-江宸｜@场景【图:s1:办公室】-办公室",
    );
    expect(segs).toEqual([
      { type: "text", value: "挂载：@人物" },
      { type: "image", assetId: "c1", name: "江宸" },
      { type: "text", value: "-江宸｜@场景" },
      { type: "image", assetId: "s1", name: "办公室" },
      { type: "text", value: "-办公室" },
    ]);
  });

  it("applyShotPromptAssetMount writes mount as @人物【图】-名 including scene", () => {
    const prompt = `[分镜01｜总时长：3秒｜画幅：9:16]
挂载：@人物-江宸｜@场景-诡市第九号当铺人事办公室
场景基调：暗沉压抑的封闭办公室。
0.0—3.0秒｜全景：江宸坐在桌边。`;
    const result = applyShotPromptAssetMount(prompt, assets);
    expect(result.changed).toBe(true);
    expect(result.mountLine).toBe(
      "挂载：@人物【图:c1:江宸】-江宸｜@人物【图:c2:苏晚璃】-苏晚璃｜@场景【图:s1:诡市第九号当铺人事办公室】-诡市第九号当铺人事办公室｜@道具【图:p1:红色契约纸】-红色契约纸",
    );
    expect(result.prompt).toMatch(
      /^\[分镜01[^\n]*\]\n挂载：@人物【图:c1:江宸】-江宸/m,
    );
    expect(result.prompt).toContain("【图:c1:江宸】坐在桌边");
    expect(result.prompt).not.toContain("@人物-江宸｜");
    expect(result.replacedNames).toContain("江宸");
  });

  it("parses image tokens for preview", () => {
    const segs = parsePromptImageSegments("前【图:c1:江宸】后");
    expect(segs).toEqual([
      { type: "text", value: "前" },
      { type: "image", assetId: "c1", name: "江宸" },
      { type: "text", value: "后" },
    ]);
  });

  it("normalizes image tokens to 图N for submit", () => {
    const prompt = "【图:c1:江宸】看向【图:s1:办公室】";
    const next = normalizePromptImageTokensForSubmit(
      prompt,
      ["c1", "p1", "s1"],
      new Map([
        ["c1", "江宸"],
        ["s1", "办公室"],
      ]),
    );
    expect(next).toBe("图1（江宸）看向图3（办公室）");
  });

  it("returns unchanged when no assets", () => {
    const prompt = "你好";
    const result = applyShotPromptAssetMount(prompt, []);
    expect(result.changed).toBe(false);
    expect(result.prompt).toBe(prompt);
  });
});
