/**
 * Storyboard video prompt hygiene.
 * Saved prompts keep model text intact — only BOM / newline / trim normalization.
 * Vendor moderation rewrites belong in a separate submit adapter, not stored prompts.
 */

export type StoryboardPromptPolicyHit = {
  term: string;
  replacement: string;
};

const SCRIPT_META_START =
  /(?:^|\n)\s*【第\s*\d+\s*集(?:完|输出完毕)】/u;

const SCRIPT_META_SECTIONS: RegExp[] = [
  /(?:^|\n)\s*本集统计[：:][^\n]*(?:\n(?!\s*【)[^\n]*)*/gu,
  /(?:^|\n)\s*改编说明[：:][\s\S]*?(?=(?:\n\s*请确认[：:])|$)/gu,
  /(?:^|\n)\s*请确认[：:][\s\S]*$/gu,
];

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

/** @deprecated No longer used for stored prompts; kept for callers that inspect hits. */
export function findProhibitedStoryboardPromptTerms(
  _text: string,
): StoryboardPromptPolicyHit[] {
  return [];
}

/**
 * Normalize line endings and trim — do not rewrite plot words or drop lines.
 */
export function sanitizeStoryboardVideoPromptText(text: string): string {
  let next = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Trim only the outer edges; keep internal spacing and blank lines as the model wrote them.
  next = next.replace(/^\n+/, "").replace(/\n+$/, "").trimEnd();
  return next.trimStart();
}
