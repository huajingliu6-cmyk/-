import { describe, expect, it } from "vitest";
import {
  matchEpisodeTitleLine,
  parseChineseEpisodeNumber,
  parseScriptTxtEpisodes,
  toScriptEpisodes,
} from "@/projects/script/script-txt-parser";

describe("parseChineseEpisodeNumber", () => {
  it("handles arabic and common chinese 1-999", () => {
    expect(parseChineseEpisodeNumber("1")).toBe(1);
    expect(parseChineseEpisodeNumber("12")).toBe(12);
    expect(parseChineseEpisodeNumber("一")).toBe(1);
    expect(parseChineseEpisodeNumber("十二")).toBe(12);
    expect(parseChineseEpisodeNumber("二十")).toBe(20);
    expect(parseChineseEpisodeNumber("一百")).toBe(100);
    expect(parseChineseEpisodeNumber("两")).toBe(2);
  });
});

describe("matchEpisodeTitleLine", () => {
  it("matches Chinese and English titles", () => {
    expect(matchEpisodeTitleLine("第1集")?.episodeNumber).toBe(1);
    expect(matchEpisodeTitleLine("第 01 集：开端")?.restTitle).toContain("开端");
    expect(matchEpisodeTitleLine("第一集")?.episodeNumber).toBe(1);
    expect(matchEpisodeTitleLine("第十二集")?.episodeNumber).toBe(12);
    expect(matchEpisodeTitleLine("第三回")?.episodeNumber).toBe(3);
    expect(matchEpisodeTitleLine("EP 1")?.episodeNumber).toBe(1);
    expect(matchEpisodeTitleLine("EP1")?.episodeNumber).toBe(1);
    expect(matchEpisodeTitleLine("EPISODE 2")?.episodeNumber).toBe(2);
    expect(matchEpisodeTitleLine("Episode 12: Title")?.restTitle).toContain(
      "Title",
    );
  });

  it("does not match scene/act/chapter/shot lines", () => {
    expect(matchEpisodeTitleLine("第1场")).toBeNull();
    expect(matchEpisodeTitleLine("场景1")).toBeNull();
    expect(matchEpisodeTitleLine("第一幕")).toBeNull();
    expect(matchEpisodeTitleLine("第一章")).toBeNull();
    expect(matchEpisodeTitleLine("镜头1")).toBeNull();
    expect(matchEpisodeTitleLine("1.")).toBeNull();
    expect(matchEpisodeTitleLine("他说：第一集很好看")).toBeNull();
  });
});

describe("parseScriptTxtEpisodes", () => {
  it("splits 第1集 / 第2集", () => {
    const text = ["第1集", "甲正文", "", "第2集", "乙正文"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodeCount).toBe(2);
    expect(parsed.episodes[0]?.content).toContain("甲正文");
    expect(parsed.episodes[1]?.content).toContain("乙正文");
  });

  it("handles 第一集 / 第十二集", () => {
    const text = ["第一集", "a", "第十二集", "b"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodes.map((e) => e.episodeNumber)).toEqual([1, 12]);
  });

  it("handles EP / EPISODE", () => {
    const text = ["EP 1", "one", "EPISODE 2", "two"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodeCount).toBe(2);
  });

  it("keeps CRLF and indentation", () => {
    const text = "第1集\r\n\t对白一行\r\n\n空行后\r\n";
    // decoder normalizes before parse; simulate normalized
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const again = parseScriptTxtEpisodes(normalized);
    expect(again.episodes[0]?.content).toContain("\t对白一行");
    expect(again.episodes[0]?.content).toContain("\n\n");
  });

  it("creates one episode when no titles", () => {
    const parsed = parseScriptTxtEpisodes("整段没有标题的长文本……".repeat(20), {
      defaultTitle: "剧本A",
    });
    expect(parsed.episodeCount).toBe(1);
    expect(parsed.episodes[0]?.title).toBe("剧本A");
  });

  it("does not split on 第1场 / 第一幕 / 第一章", () => {
    const text = ["第1场", "动作", "第一幕", "开场", "第一章", "叙述"].join(
      "\n",
    );
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodeCount).toBe(1);
  });

  it("keeps duplicate numbers with warning and unique ids", () => {
    const text = ["第1集", "A", "第1集", "B"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodeCount).toBe(2);
    expect(parsed.warnings.some((w) => w.includes("重复"))).toBe(true);
    const eps = toScriptEpisodes("p1", parsed.episodes);
    expect(new Set(eps.map((e) => e.id)).size).toBe(2);
  });

  it("does not reorder reverse numbers", () => {
    const text = ["第3集", "C", "第1集", "A"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodes.map((e) => e.episodeNumber)).toEqual([3, 1]);
    expect(parsed.warnings.some((w) => w.includes("逆序"))).toBe(true);
  });

  it("keeps preamble warning without dropping source", () => {
    const text = ["前言说明", "第1集", "正文"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.preamble).toContain("前言说明");
    expect(parsed.warnings.some((w) => w.includes("前置"))).toBe(true);
    expect(parsed.episodes[0]?.content).toContain("正文");
  });

  it("warns on empty episode body", () => {
    const text = ["第1集", "", "第2集", "有内容"].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.warnings.some((w) => w.includes("正文为空"))).toBe(true);
  });

  it("does not treat 第一集正文 as a title line", () => {
    expect(matchEpisodeTitleLine("第一集正文，林清走进茶馆。")).toBeNull();
    const text = [
      "第1集：初遇",
      "第一集正文，林清走进茶馆。",
      "第2集：冲突",
      "第二集正文",
    ].join("\n");
    const parsed = parseScriptTxtEpisodes(text);
    expect(parsed.episodeCount).toBe(2);
    expect(parsed.episodes[0]?.content).toContain("第一集正文");
  });
});
