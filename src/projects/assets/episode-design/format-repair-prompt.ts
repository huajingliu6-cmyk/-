/**
 * One-shot format-only repair prompt. Must not re-analyze the script.
 */

export function buildAssetJsonFormatRepairUserPrompt(brokenOutput: string): string {
  return [
    "[FORMAT_REPAIR_ONLY]",
    "将下列内容修复为单个合法 JSON 对象。",
    "只允许修正语法（尾逗号、缺引号、代码围栏、轻微截断补全括号）。",
    "禁止重新分析剧本、禁止增删资产含义、禁止输出解释。",
    "目标形状：{\"version\":1,\"assets\":[{\"type\":\"character|scene|prop|audio\",\"name\":\"...\",\"design\":{...}}]}",
    "usageInEpisode 必须位于 design 内。",
    "<BROKEN_OUTPUT>",
    brokenOutput.slice(0, 60_000),
    "</BROKEN_OUTPUT>",
  ].join("\n");
}

export const ASSET_JSON_FORMAT_REPAIR_SYSTEM_PROMPT = [
  "你是 JSON 格式修复器，不是编剧。",
  "只输出一个 JSON 对象，不要 markdown 解释。",
].join("\n");
