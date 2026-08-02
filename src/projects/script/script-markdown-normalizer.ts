/**
 * Minimal Markdown → plain-text normalization for episode splitting.
 * Does not render HTML, fetch URLs, or execute anything.
 *
 * Returns `nonTitleLineIndexes` so fence / Front Matter / HTML blocks
 * keep readable sourceText without becoming episode titles.
 */

import { matchEpisodeTitleLine } from "@/projects/script/script-txt-parser";

export type MarkdownNormalizeResult = {
  text: string;
  warnings: string[];
  /** 0-based indexes into the joined `text` lines that must not match as titles. */
  nonTitleLineIndexes: number[];
};

/** ATX: 1–6 hashes + required whitespace + optional closing hashes. */
const ATX_HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
const MD_IMAGE = /!\[[^\]]*]\([^)]*\)/;
const MD_LINK = /\[[^\]]*]\([^)]*\)/;

type OutLine = { text: string; skipTitle: boolean };

function pushLine(out: OutLine[], text: string, skipTitle: boolean): void {
  out.push({ text, skipTitle });
}

/** Keep fence body readable but safe if re-parsed as plain TXT (no skip metadata). */
function fenceBodyForSourceText(line: string): string {
  if (line === "" || /^[ \t]/.test(line)) return line;
  return `    ${line}`;
}

function isFenceClose(
  line: string,
  openMarker: string,
): boolean {
  const m = FENCE_OPEN.exec(line);
  if (!m) return false;
  const marker = m[2]!;
  return (
    marker[0] === openMarker[0] &&
    marker.length >= openMarker.length &&
    (m[3] ?? "").trim() === ""
  );
}

/**
 * Convert Markdown source into plain text + title-skip metadata.
 */
export function normalizeMarkdownForScript(raw: string): MarkdownNormalizeResult {
  const warnings = new Set<string>();
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: OutLine[] = [];

  let i = 0;

  // YAML Front Matter only at document start.
  if (lines[0]?.trim() === "---") {
    let close = -1;
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j]!.trim() === "---") {
        close = j;
        break;
      }
    }
    if (close > 0) {
      warnings.add("检测到 Markdown Front Matter，已作为普通前置信息保留。");
      for (let j = 0; j <= close; j += 1) {
        pushLine(out, lines[j]!, true);
      }
      i = close + 1;
    } else {
      warnings.add("检测到未闭合的 Markdown Front Matter，已按普通文本处理。");
      // Safe degrade: keep opening --- as ordinary text; do not swallow body.
      pushLine(out, lines[0]!, true);
      i = 1;
    }
  }

  let inFence: string | null = null;
  let fenceUnclosed = false;

  for (; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (inFence) {
      if (isFenceClose(line, inFence)) {
        inFence = null;
        // Drop closing fence marker; content already retained.
        continue;
      }
      pushLine(out, fenceBodyForSourceText(line), true);
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      inFence = fence[2]!;
      warnings.add("文档包含代码块标记，已按纯文本保留内容");
      // Drop opening fence marker line.
      continue;
    }

    // Setext: only when the title line itself is an episode title.
    if (
      i + 1 < lines.length &&
      SETEXT_UNDERLINE.test(lines[i + 1]!.trim()) &&
      line.trim() &&
      matchEpisodeTitleLine(line.trim())
    ) {
      pushLine(out, line.trimEnd(), false);
      i += 1; // drop underline only
      continue;
    }

    // ATX episode headings: require space after #; strip markers only when
    // remaining text is a C1 episode title.
    const atx = ATX_HEADING.exec(line);
    if (atx) {
      const rest = (atx[2] ?? "").trimEnd();
      if (matchEpisodeTitleLine(rest)) {
        pushLine(out, rest, false);
        continue;
      }
      // Ordinary Markdown heading — keep original so it will not match titles.
      pushLine(out, line, false);
      continue;
    }

    if (HTML_TAG.test(line)) {
      warnings.add("文档包含 HTML 标签，已作为普通文本保留（不执行、不渲染）");
      // Keep raw HTML; skip title match so stripping cannot invent episodes.
      pushLine(out, line, true);
      continue;
    }

    if (MD_IMAGE.test(line) || MD_LINK.test(line)) {
      warnings.add("文档包含 Markdown 链接或图片语法，已保留原文且未访问网络");
      // Keep original Markdown; whole-line titles won't match link/image forms.
      pushLine(out, line, false);
      continue;
    }

    // Keep blockquotes / lists with their prefixes so they cannot become titles.
    pushLine(out, line, false);
  }

  if (inFence) {
    fenceUnclosed = true;
    warnings.add("文档包含未闭合代码块，已按纯文本处理且不参与分集标题识别");
  }
  void fenceUnclosed;

  const textLines = out.map((l) => l.text);
  const nonTitleLineIndexes = out
    .map((l, idx) => (l.skipTitle ? idx : -1))
    .filter((idx) => idx >= 0);

  // Outer trim like TXT normalize: trim leading/trailing blank lines only via
  // overall join + trim, adjusting indexes.
  let start = 0;
  let end = textLines.length;
  while (start < end && textLines[start]!.trim() === "") start += 1;
  while (end > start && textLines[end - 1]!.trim() === "") end -= 1;
  const sliced = textLines.slice(start, end);
  const adjusted = nonTitleLineIndexes
    .filter((idx) => idx >= start && idx < end)
    .map((idx) => idx - start);

  return {
    text: sliced.join("\n"),
    warnings: [...warnings],
    nonTitleLineIndexes: adjusted,
  };
}
