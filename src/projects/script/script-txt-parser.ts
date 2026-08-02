import { randomUUID } from "crypto";
import { countVisibleChars } from "@/text-generation/char-count";
import type { ScriptEpisode } from "@/projects/script/types";

export type ParsedScriptEpisodeDraft = {
  episodeNumber: number;
  title: string;
  content: string;
  wordCount: number;
};

export type ScriptTxtParseResult = {
  episodes: ParsedScriptEpisodeDraft[];
  warnings: string[];
  preamble: string;
  episodeCount: number;
  characterCount: number;
};

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * Parse common Chinese numerals in 1–999 range used in episode titles.
 */
export function parseChineseEpisodeNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  if (s === "十") return 10;
  if (s === "百") return 100;

  // 一百 / 两百 / 九百…
  const hundredMatch = /^([零〇一二两三四五六七八九])?百([零〇一二三四五六七八九]?十?[零〇一二三四五六七八九]?)?$/.exec(
    s,
  );
  if (hundredMatch) {
    const hundreds = hundredMatch[1] ? CN_DIGIT[hundredMatch[1]]! : 1;
    const rest = hundredMatch[2] ?? "";
    if (!rest || rest === "零" || rest === "〇") return hundreds * 100;
    const restNum = parseChineseEpisodeNumber(rest.replace(/^零|^〇/, ""));
    if (restNum === null) return null;
    return hundreds * 100 + restNum;
  }

  // 十X / 一十X / X十 / X十Y
  if (s.startsWith("十")) {
    const ones = s.slice(1);
    if (!ones) return 10;
    const o = CN_DIGIT[ones];
    return o === undefined ? null : 10 + o;
  }

  const tenMatch = /^([一二两三四五六七八九])十([零〇一二三四五六七八九])?$/.exec(
    s,
  );
  if (tenMatch) {
    const tens = CN_DIGIT[tenMatch[1]!]!;
    const onesRaw = tenMatch[2];
    if (!onesRaw || onesRaw === "零" || onesRaw === "〇") return tens * 10;
    const ones = CN_DIGIT[onesRaw];
    return ones === undefined ? null : tens * 10 + ones;
  }

  if (s.length === 1 && CN_DIGIT[s] !== undefined) {
    const n = CN_DIGIT[s]!;
    return n >= 1 ? n : null;
  }

  return null;
}

type TitleMatch = {
  episodeNumber: number;
  titleLine: string;
  restTitle: string;
};

/**
 * Match a whole line that clearly denotes an episode boundary.
 * Does NOT match 第1场 / 第一幕 / 第一章 / 镜头1 / dialogue mentions.
 */
export function matchEpisodeTitleLine(line: string): TitleMatch | null {
  // Indented lines are never episode titles (code / fence bodies stay body text).
  if (/^[ \t]/.test(line)) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 第 N 集 / 回 — after 集/回 only EOL, colon, or whitespace+title (not 第一集正文)
  const cn =
    /^第\s*([0-9]+|[零〇一二两三四五六七八九十百]+)\s*([集回])(?:\s*[:：]\s*(.*)?|\s+(.*))?$/.exec(
      trimmed,
    );
  if (cn) {
    const num = parseChineseEpisodeNumber(cn[1]!);
    if (num === null) return null;
    const rest = ((cn[3] ?? cn[4] ?? "") as string).trim();
    const unit = cn[2]!;
    const base = `第${num}${unit}`;
    return {
      episodeNumber: num,
      titleLine: trimmed,
      restTitle: rest ? `${base}：${rest}` : base,
    };
  }

  // EP / EPISODE / Episode N
  const en =
    /^(?:EP|EPISODE|Episode)\s*([0-9]+)\s*(?:[:：]\s*|\s+)?(.*)$/i.exec(
      trimmed,
    );
  if (en) {
    const num = Number(en[1]);
    if (!Number.isFinite(num) || num < 1) return null;
    const rest = (en[2] ?? "").trim();
    const base = `第${num}集`;
    return {
      episodeNumber: num,
      titleLine: trimmed,
      restTitle: rest ? `${base}：${rest}` : base,
    };
  }

  return null;
}

function pushEpisode(
  episodes: ParsedScriptEpisodeDraft[],
  episodeNumber: number,
  title: string,
  bodyLines: string[],
): void {
  // Preserve internal blank lines / indentation; only drop a single leading blank after title.
  let lines = [...bodyLines];
  if (lines[0] === "") lines = lines.slice(1);
  // Drop one trailing empty line artifact from split joins.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const content = lines.join("\n");
  episodes.push({
    episodeNumber,
    title,
    content,
    wordCount: countVisibleChars(content),
  });
}

/**
 * Split normalized source text into episodes by explicit title lines only.
 * No title → single episode. Appearance order preserved (no renumber sort).
 */
export function parseScriptTxtEpisodes(
  sourceText: string,
  options?: {
    defaultTitle?: string;
    /** Line indexes that must never be treated as episode titles. */
    nonTitleLineIndexes?: ReadonlyArray<number> | ReadonlySet<number>;
  },
): ScriptTxtParseResult {
  const warnings: string[] = [];
  const lines = sourceText.split("\n");
  const skipTitles = new Set<number>(
    options?.nonTitleLineIndexes
      ? [...options.nonTitleLineIndexes]
      : [],
  );
  const titleHits: { lineIndex: number; match: TitleMatch }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (skipTitles.has(i)) continue;
    const match = matchEpisodeTitleLine(lines[i]!);
    if (match) titleHits.push({ lineIndex: i, match });
  }

  if (titleHits.length === 0) {
    const content = sourceText;
    const title = options?.defaultTitle?.trim() || "第1集";
    const episodes: ParsedScriptEpisodeDraft[] = [
      {
        episodeNumber: 1,
        title,
        content,
        wordCount: countVisibleChars(content),
      },
    ];
    if (!content.trim()) {
      warnings.push("解析结果正文为空");
    }
    return {
      episodes,
      warnings,
      preamble: "",
      episodeCount: 1,
      characterCount: countVisibleChars(sourceText),
    };
  }

  const preambleLines = lines.slice(0, titleHits[0]!.lineIndex);
  const preamble = preambleLines.join("\n").replace(/^\n+|\n+$/g, "");
  if (preamble.trim()) {
    warnings.push("首集标题前存在前置信息");
  }

  const episodes: ParsedScriptEpisodeDraft[] = [];
  const seenNumbers = new Set<number>();
  let previousNumber: number | null = null;

  for (let h = 0; h < titleHits.length; h += 1) {
    const hit = titleHits[h]!;
    const start = hit.lineIndex + 1;
    const end =
      h + 1 < titleHits.length ? titleHits[h + 1]!.lineIndex : lines.length;
    const body = lines.slice(start, end);
    const num = hit.match.episodeNumber;

    if (seenNumbers.has(num)) {
      warnings.push(`集号 ${num} 重复，已按出现顺序保留多集`);
    }
    seenNumbers.add(num);

    if (previousNumber !== null && num < previousNumber) {
      warnings.push(`集号出现逆序（${previousNumber} → ${num}），已按原文顺序保留`);
    }
    previousNumber = num;

    pushEpisode(episodes, num, hit.match.restTitle, body);
    if (!episodes[episodes.length - 1]!.content.trim()) {
      warnings.push(`第 ${episodes.length} 条分集正文为空（标题：${hit.match.restTitle}）`);
    }
  }

  const allEmpty = episodes.every((ep) => !ep.content.trim());
  if (allEmpty) {
    warnings.push("全部剧集正文为空");
  }

  return {
    episodes,
    warnings,
    preamble,
    episodeCount: episodes.length,
    characterCount: countVisibleChars(sourceText),
  };
}

export function toScriptEpisodes(
  projectId: string,
  drafts: ParsedScriptEpisodeDraft[],
  now = new Date().toISOString(),
): ScriptEpisode[] {
  return drafts.map((draft) => ({
    id: `ep_${randomUUID().replace(/-/g, "")}`,
    projectId,
    episodeNumber: draft.episodeNumber,
    title: draft.title,
    content: draft.content,
    wordCount: draft.wordCount,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  }));
}

export function assertParseAcceptable(parsed: ScriptTxtParseResult): {
  ok: true;
} | { ok: false; message: string } {
  if (parsed.episodes.length === 0) {
    return { ok: false, message: "未能解析出任何剧集" };
  }
  const hasAnyBody = parsed.episodes.some((ep) => ep.content.trim());
  if (!hasAnyBody) {
    return { ok: false, message: "解析结果正文全部为空" };
  }
  return { ok: true };
}
