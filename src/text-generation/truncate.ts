import { countVisibleChars } from "@/text-generation/char-count";

const BOUNDARIES = new Set(["。", "！", "？", ".", "!", "?", "\n"]);

/**
 * 在可见字符上限内截断到最近完整句边界，避免半个 Unicode。
 */
export function truncateToVisibleCharLimit(
  text: string,
  maxVisible: number,
): { text: string; truncated: boolean } {
  if (countVisibleChars(text) <= maxVisible) {
    return { text, truncated: false };
  }

  let visible = 0;
  let cut = 0;
  let lastBoundary = -1;
  for (const ch of text) {
    const isSpace = ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
    if (!isSpace) visible += 1;
    cut += ch.length;
    if (BOUNDARIES.has(ch)) lastBoundary = cut;
    if (visible >= maxVisible) break;
  }

  const end = lastBoundary > 0 ? lastBoundary : cut;
  return { text: text.slice(0, end), truncated: true };
}
