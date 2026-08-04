/**
 * 统一字数统计：Unicode 可见字符；空格与换行不计数；标点计数。
 * 前后端共用，禁止各写一套。
 */
export function countVisibleChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
    n += 1;
  }
  return n;
}

export const BRIEF_MAX_CHARS = 3000;
/** 智能分集需携带完整源文本块列表，上限远高于普通 brief。 */
export const SCRIPT_SPLIT_BRIEF_MAX_CHARS = 200_000;
/** 全剧本资产提取同样需要携带完整源文本。 */
export const SCRIPT_ASSET_DESIGN_BRIEF_MAX_CHARS = 200_000;
export const TARGET_CHARS_MIN = 100;
export const TARGET_CHARS_MAX = 1000;
export const DEFAULT_TARGET_CHARS = 500;

export function isValidTargetChars(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= TARGET_CHARS_MIN &&
    value <= TARGET_CHARS_MAX
  );
}
