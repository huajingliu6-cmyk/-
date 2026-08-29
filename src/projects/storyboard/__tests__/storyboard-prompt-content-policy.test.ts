import { describe, expect, it } from "vitest";
import {
  findProhibitedStoryboardPromptTerms,
  sanitizeStoryboardVideoPromptText,
  stripScriptMetaForStoryboard,
} from "@/projects/storyboard/services/storyboard-prompt-content-policy";

describe("stripScriptMetaForStoryboard", () => {
  it("removes episode completion and adaptation meta blocks", () => {
    const raw = [
      "场景一：雨夜办公室",
      "韩兆丰推门而入。",
      "",
      "【第1集完】",
      "【第1集输出完毕】",
      "本集统计：约1680字｜3个场景｜约5分钟",
      "改编说明：保留序章剧情，关键词包括：时间、抽烟、威士忌、灯暗。",
      "请确认：是否需要修改？回复「继续」进入下一集。",
    ].join("\n");

    const cleaned = stripScriptMetaForStoryboard(raw);
    expect(cleaned).toContain("雨夜办公室");
    expect(cleaned).toContain("韩兆丰推门而入");
    expect(cleaned).not.toContain("【第1集输出完毕】");
    expect(cleaned).not.toContain("本集统计");
    expect(cleaned).not.toContain("改编说明");
    expect(cleaned).not.toContain("请确认");
  });
});

describe("sanitizeStoryboardVideoPromptText", () => {
  it("preserves model body including plot words and 禁止 lines", () => {
    const raw =
      "中景：他抽烟，端起威士忌一饮而尽。\n禁止完全静止画面。\n台词：无。";
    const cleaned = sanitizeStoryboardVideoPromptText(raw);
    expect(cleaned).toContain("抽烟");
    expect(cleaned).toContain("威士忌");
    expect(cleaned).toContain("禁止完全静止画面");
    expect(cleaned).toContain("\n");
  });

  it("only trims edges and normalizes newlines", () => {
    const raw = "\uFEFF  【总时长】14秒\r\n\r\n【声音设计】雨声  ";
    const cleaned = sanitizeStoryboardVideoPromptText(raw);
    expect(cleaned).toBe("【总时长】14秒\n\n【声音设计】雨声");
  });

  it("does not report prohibited terms for stored prompts", () => {
    expect(findProhibitedStoryboardPromptTerms("他点烟后喝酒。")).toEqual([]);
  });
});
