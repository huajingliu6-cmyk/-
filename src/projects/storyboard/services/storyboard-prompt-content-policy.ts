/**
 * Storyboard video prompt hygiene for platform moderation and script paste cleanup.
 * Keeps plot beats while avoiding common video-provider rejections.
 */

export type StoryboardPromptPolicyHit = {
  term: string;
  replacement: string;
};

const PROMPT_TERM_REWRITES: Array<{
  pattern: RegExp;
  replacement: string;
  label: string;
}> = [
  {
    label: "抽烟",
    pattern: /抽烟|吸烟|点烟|叼烟|吐烟|香烟|卷烟|雪茄|烟草|尼古丁|烟灰|烟圈|烟雾缭绕/gu,
    replacement: "神情凝重、指尖轻敲桌面",
  },
  {
    label: "饮酒",
    pattern:
      /威士忌|白酒|红酒|啤酒|黄酒|洋酒|烈酒|鸡尾酒|酒杯|酒液|喝酒|饮酒|酗酒|微醺|醉意|醉醺醺/gu,
    replacement: "手持透明玻璃杯、杯中浅色饮品",
  },
  {
    label: "毒品",
    pattern: /吸毒|贩毒|毒品|海洛因|可卡因|大麻|冰毒|针管注射毒品/gu,
    replacement: "违禁物（不出现具体描写）",
  },
  {
    label: "血腥",
    pattern: /鲜血喷溅|血肉模糊|断肢|内脏外露|大量流血/gu,
    replacement: "受伤痕迹、衣料破损",
  },
];

const SCRIPT_META_START =
  /(?:^|\n)\s*【第\s*\d+\s*集(?:完|输出完毕)】/u;

const SCRIPT_META_SECTIONS: RegExp[] = [
  /(?:^|\n)\s*本集统计[：:][^\n]*(?:\n(?!\s*【)[^\n]*)*/gu,
  /(?:^|\n)\s*改编说明[：:][\s\S]*?(?=(?:\n\s*请确认[：:])|$)/gu,
  /(?:^|\n)\s*请确认[：:][\s\S]*$/gu,
];

/** Echoed task-rule lines like「禁止完全静止画面」must not appear in final video prompts. */
const RULE_ECHO_LINE =
  /^(?:禁止|不得|不允许|请勿|不要输出|不要写|严禁).{0,120}$/u;

/**
 * Remove LLM/script-generation meta blocks (stats, adaptation notes, confirmations)
 * before feeding script into storyboard prompt generation.
 */
export function stripScriptMetaForStoryboard(scriptText: string): string {
  let text = scriptText.replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const metaStart = text.search(SCRIPT_META_START);
  if (metaStart >= 0) {
    text = text.slice(0, metaStart).trimEnd();
  }

  for (const re of SCRIPT_META_SECTIONS) {
    text = text.replace(re, "\n");
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function findProhibitedStoryboardPromptTerms(
  text: string,
): StoryboardPromptPolicyHit[] {
  const hits: StoryboardPromptPolicyHit[] = [];
  for (const rule of PROMPT_TERM_REWRITES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      hits.push({ term: rule.label, replacement: rule.replacement });
    }
  }
  return hits;
}

function stripRuleEchoSentences(text: string): string {
  const segments = text.split(/(?<=[。！？!?])/u);
  const kept = segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !RULE_ECHO_LINE.test(segment));
  return kept.join("").trim();
}

/**
 * Rewrite sensitive depictions and drop echoed rule boilerplate from a video prompt.
 */
export function sanitizeStoryboardVideoPromptText(text: string): string {
  let next = text.replace(/\r\n/g, "\n").trim();
  if (!next) return "";

  for (const rule of PROMPT_TERM_REWRITES) {
    rule.pattern.lastIndex = 0;
    next = next.replace(rule.pattern, rule.replacement);
  }

  next = stripRuleEchoSentences(next);
  next = next
    .split("\n")
    .map((line) => stripRuleEchoSentences(line))
    .filter(Boolean)
    .join("\n");

  return next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
