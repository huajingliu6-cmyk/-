import { describe, expect, it } from "vitest";
import { normalizeMarkdownForScript } from "@/projects/script/script-markdown-normalizer";
import {
  matchEpisodeTitleLine,
  parseScriptTxtEpisodes,
} from "@/projects/script/script-txt-parser";
import {
  buildScriptMarkdownImportPreview,
  isMarkdownFileName,
} from "@/projects/script/script-markdown-import";
import { scriptDraftContentFingerprint } from "@/projects/script/script-content-fingerprint";
import { SCRIPT_MARKDOWN_MAX_BYTES } from "@/projects/script/script-markdown-constants";

function parseMd(raw: string, defaultTitle = "文档") {
  const n = normalizeMarkdownForScript(raw);
  return {
    ...n,
    parsed: parseScriptTxtEpisodes(n.text, {
      defaultTitle,
      nonTitleLineIndexes: n.nonTitleLineIndexes,
    }),
  };
}

describe("normalizeMarkdownForScript gaps", () => {
  it("ATX 1-6 with required space; closing hashes; no space rejected as title strip", () => {
    const md = [
      "# 第1集：A",
      "a",
      "## 第2集：B ##",
      "b",
      "###### 第3集：C",
      "c",
      "#人物介绍",
      "####### 第9集",
    ].join("\n");
    const { text, parsed } = parseMd(md);
    expect(text).toContain("第1集：A");
    expect(text).not.toMatch(/^# 第1集/m);
    expect(text).toContain("#人物介绍");
    expect(text).toContain("####### 第9集");
    expect(parsed.episodeCount).toBe(3);
  });

  it("ordinary markdown headings do not become episodes", () => {
    const md = ["# 人物介绍", "说明", "## 世界观", "### 第一幕"].join("\n");
    expect(parseMd(md).parsed.episodeCount).toBe(1);
  });

  it("Setext episode titles work; ordinary HR preserved", () => {
    const md = [
      "第1集：初遇",
      "============",
      "正文",
      "",
      "人物介绍",
      "---",
      "继续",
      "",
      "----------------",
    ].join("\n");
    const { text, parsed } = parseMd(md);
    expect(text).not.toContain("============");
    expect(text).toContain("人物介绍");
    expect(text).toContain("---");
    expect(parsed.episodeCount).toBe(1);
    expect(parsed.episodes[0]?.title).toContain("初遇");
  });

  it("Front Matter warning; inner episode text not titled", () => {
    const md = [
      "---",
      "title: 示例",
      "episode: 第77集",
      "---",
      "",
      "# 第1集：初遇",
      "正文",
    ].join("\n");
    const { warnings, parsed, text } = parseMd(md);
    expect(warnings.some((w) => w.includes("Front Matter"))).toBe(true);
    expect(text).toContain("第77集");
    expect(parsed.episodeCount).toBe(1);
    expect(parsed.episodes[0]?.title).toContain("初遇");
  });

  it("fences backtick and tilde block titles including plain 第N集", () => {
    const md = [
      "# 第1集：开端",
      "开端正文。",
      "```text",
      "# 第98集：代码标题",
      "第99集：代码纯文本标题",
      "```",
      "~~~text",
      "EPISODE 100: fenced example",
      "~~~",
      "",
      "# 第2集：后续",
      "后续正文。",
    ].join("\n");
    const { text, parsed, warnings } = parseMd(md);
    expect(text).toContain("# 第98集：代码标题");
    expect(text).toContain("第99集：代码纯文本标题");
    expect(text).toContain("EPISODE 100: fenced example");
    expect(warnings.some((w) => w.includes("代码块"))).toBe(true);
    expect(parsed.episodeCount).toBe(2);
    expect(parsed.episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
    // Normalized text must stay 2 episodes when re-parsed as plain TXT.
    expect(parseScriptTxtEpisodes(text).episodeCount).toBe(2);
  });

  it("unclosed fence: trailing content not titled; warning", () => {
    const md = [
      "# 第1集：开端",
      "正文",
      "```",
      "第99集：未闭合",
      "EPISODE 100: still inside",
    ].join("\n");
    const { parsed, warnings } = parseMd(md);
    expect(warnings.some((w) => w.includes("未闭合"))).toBe(true);
    expect(parsed.episodeCount).toBe(1);
  });

  it("blockquote and lists do not become episodes", () => {
    const md = [
      "# 第1集：开端",
      "正文",
      "> 第88集：引用示例",
      "- 第89集：列表示例",
      "* 第4集",
      "+ 第5集",
      "1. 第6集",
      "2) 第7集",
    ].join("\n");
    const { text, parsed } = parseMd(md);
    expect(text).toContain("> 第88集");
    expect(text).toContain("- 第89集");
    expect(parsed.episodeCount).toBe(1);
  });

  it("HTML/link/image keep raw text and do not invent titles", () => {
    const md = [
      "# 第1集：开端",
      "开端正文。",
      "<div>第92集</div>",
      "<script>alert(1)</script>",
      "[第90集](https://example.com/episode)",
      "![第91集](https://example.com/image.png)",
      "[参考链接](https://example.com)",
    ].join("\n");
    const { text, parsed, warnings } = parseMd(md);
    expect(text).toContain("<div>第92集</div>");
    expect(text).toContain("[第90集](https://example.com/episode)");
    expect(text).toContain("![第91集](https://example.com/image.png)");
    expect(warnings.some((w) => w.includes("HTML"))).toBe(true);
    expect(warnings.some((w) => w.includes("链接") || w.includes("图片"))).toBe(
      true,
    );
    expect(parsed.episodeCount).toBe(1);
  });

  it("smoke composite normalized text equals TXT fingerprint without nonTitle meta", () => {
    const mdRaw = [
      "---",
      "title: 三集测试",
      "author: Smoke",
      "episodeExample: 第77集",
      "---",
      "",
      "# 第1集：初遇",
      "",
      "第一集正文。",
      "",
      "> 第88集：引用示例",
      "",
      "- 第89集：列表示例",
      "",
      "[第90集](https://example.com/episode)",
      "",
      "![第91集](https://example.com/image.png)",
      "",
      "<div>第92集</div>",
      "",
      "第2集：冲突",
      "------------",
      "",
      "第二集正文。",
      "",
      "### EPISODE 3: Turning Point",
      "",
      "第三集正文。",
      "",
      "```text",
      "# 第98集：代码标题",
      "第99集：代码纯文本标题",
      "```",
      "",
      "~~~text",
      "EPISODE 100: fenced example",
      "~~~",
    ].join("\n");
    const md = normalizeMarkdownForScript(mdRaw);
    const mdParsed = parseScriptTxtEpisodes(md.text, {
      nonTitleLineIndexes: md.nonTitleLineIndexes,
    });
    const txtParsed = parseScriptTxtEpisodes(md.text);
    expect(mdParsed.episodeCount).toBe(3);
    expect(txtParsed.episodeCount).toBe(3);
    const toEps = (parsed: typeof mdParsed) =>
      parsed.episodes.map((e, i) => ({
        id: `e${i}`,
        projectId: "p",
        episodeNumber: e.episodeNumber,
        title: e.title,
        content: e.content,
        wordCount: e.wordCount,
        status: "ready" as const,
        createdAt: "t",
        updatedAt: "t",
      }));
    expect(
      scriptDraftContentFingerprint({
        sourceText: md.text,
        preambleNotes: mdParsed.preamble || null,
        episodes: toEps(mdParsed),
      }),
    ).toBe(
      scriptDraftContentFingerprint({
        sourceText: md.text,
        preambleNotes: txtParsed.preamble || null,
        episodes: toEps(txtParsed),
      }),
    );
  });

  it("smoke composite fixture yields exactly 3 episodes", () => {
    const md = [
      "---",
      "title: 三集测试",
      "author: Smoke",
      "episodeExample: 第77集",
      "---",
      "",
      "# 第1集：初遇",
      "",
      "第一集正文。",
      "",
      "> 第88集：引用示例",
      "",
      "- 第89集：列表示例",
      "",
      "[第90集](https://example.com/episode)",
      "",
      "![第91集](https://example.com/image.png)",
      "",
      "<div>第92集</div>",
      "",
      "第2集：冲突",
      "------------",
      "",
      "第二集正文。",
      "",
      "### EPISODE 3: Turning Point",
      "",
      "第三集正文。",
      "",
      "```text",
      "# 第98集：代码标题",
      "第99集：代码纯文本标题",
      "```",
      "",
      "~~~text",
      "EPISODE 100: fenced example",
      "~~~",
    ].join("\n");
    const { parsed } = parseMd(md);
    expect(parsed.episodeCount).toBe(3);
    expect(parsed.episodes.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
  });

  it("TXT and MD equivalent content share fingerprint", () => {
    const md = normalizeMarkdownForScript("# 第1集：初遇\n\n正文");
    const txt = "第1集：初遇\n\n正文";
    expect(md.text).toBe(txt);
    const mdParsed = parseScriptTxtEpisodes(md.text, {
      nonTitleLineIndexes: md.nonTitleLineIndexes,
    });
    const txtParsed = parseScriptTxtEpisodes(txt);
    expect(
      scriptDraftContentFingerprint({
        sourceText: md.text,
        preambleNotes: mdParsed.preamble || null,
        episodes: mdParsed.episodes.map((e, i) => ({
          id: `e${i}`,
          projectId: "p",
          episodeNumber: e.episodeNumber,
          title: e.title,
          content: e.content,
          wordCount: e.wordCount,
          status: "ready" as const,
          createdAt: "t",
          updatedAt: "t",
        })),
      }),
    ).toBe(
      scriptDraftContentFingerprint({
        sourceText: txt,
        preambleNotes: txtParsed.preamble || null,
        episodes: txtParsed.episodes.map((e, i) => ({
          id: `e${i}`,
          projectId: "p",
          episodeNumber: e.episodeNumber,
          title: e.title,
          content: e.content,
          wordCount: e.wordCount,
          status: "ready" as const,
          createdAt: "t",
          updatedAt: "t",
        })),
      }),
    );
  });

  it("Setext MD equals TXT fingerprint", () => {
    const md = normalizeMarkdownForScript("第1集：初遇\n============\n\n正文");
    expect(md.text).toBe("第1集：初遇\n\n正文");
  });
});

describe("buildScriptMarkdownImportPreview", () => {
  it("accepts .md / .markdown; rejects disguises", () => {
    expect(isMarkdownFileName("a.MD")).toBe(true);
    expect(isMarkdownFileName("a.markdown")).toBe(true);
    expect(isMarkdownFileName("a.md.exe")).toBe(false);
    expect(isMarkdownFileName("a.txt")).toBe(false);
  });

  it("returns format=md with encoding; rejects empty/binary/oversize", () => {
    const ok = buildScriptMarkdownImportPreview({
      projectId: "p1",
      fileName: "story.markdown",
      bytes: new TextEncoder().encode("# 第1集：初遇\n正文"),
      mimeType: "text/markdown",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.preview.format).toBe("md");
      expect(ok.preview.encoding).toBe("utf-8");
      expect(ok.preview.episodeCount).toBe(1);
    }

    expect(
      buildScriptMarkdownImportPreview({
        projectId: "p1",
        fileName: "e.md",
        bytes: new TextEncoder().encode("   \n"),
      }).ok,
    ).toBe(false);

    expect(
      buildScriptMarkdownImportPreview({
        projectId: "p1",
        fileName: "b.md",
        bytes: Uint8Array.from([0, 1, 2, 0xff]),
      }).ok,
    ).toBe(false);

    const huge = new Uint8Array(SCRIPT_MARKDOWN_MAX_BYTES + 1);
    huge.fill(0x61);
    const over = buildScriptMarkdownImportPreview({
      projectId: "p1",
      fileName: "big.md",
      bytes: huge,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.status).toBe(413);
  });

  it("does not treat 第一集正文 as title", () => {
    expect(matchEpisodeTitleLine("第一集正文，林清走进茶馆。")).toBeNull();
    const built = buildScriptMarkdownImportPreview({
      projectId: "p1",
      fileName: "a.md",
      bytes: new TextEncoder().encode(
        "# 第1集：初遇\n第一集正文，林清走进茶馆。\n# 第2集：冲突\n第二集正文",
      ),
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.preview.episodeCount).toBe(2);
      expect(built.preview.episodes[0]?.content).toContain("第一集正文");
    }
  });
});
