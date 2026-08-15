import type { AiCapabilityId } from "@/ai-config/capabilities";

/** Immutable output schema / business rules — admin cannot override (H2 §17). */

export const OUTPUT_CONTRACT_VERSION = "1";

export function buildImmutableOutputContract(
  capabilityId: AiCapabilityId,
): string {
  switch (capabilityId) {
    case "script.split.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object:",
        '{"episodes":[{"episodeNumber":正整数,"title":"非空标题","startBlockId":"B000001","endBlockId":"B000003"}]}',
        "episodes must be consecutive from 1; each episode covers at least one block.",
        "startBlockId and endBlockId must come from user block IDs; all blocks covered once, no overlap.",
        "Do not output script body, explanations, or analysis.",
      ].join("\n");

    case "script.episodes.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object:",
        '{"version":1,"episodes":[{"number":正整数,"title":"非空标题","content":"非空正文"}]}',
        "episodes array must contain exactly one element; number must match requested episode number.",
      ].join("\n");

    case "asset.episode-design.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object (no markdown outside an optional single json fence):",
        '{"version":1,"assets":[ ... ]}',
        "Each asset MUST include type and name. Preferred types: character | scene | prop | audio.",
        "Put usageInEpisode INSIDE design (not only at the top level).",
        "Full examples:",
        '{"type":"character","name":"林清","description":"女主角","design":{"appearance":"28岁，短发","clothing":"深色风衣","role":"主角","usageInEpisode":"开场进入茶馆","evidence":"第一场"},"evidence":"第一场"}',
        '{"type":"scene","name":"江边码头","design":{"location":"夜色江岸","timeOfDay":"夜","style":"写实冷调","usageInEpisode":"沉匣高潮","evidence":"末场"}}',
        '{"type":"prop","name":"铜匣","design":{"propType":"关键道具","usage":"收藏信物","usageInEpisode":"随身携带后沉江","evidence":"开场"}}',
        '{"type":"audio","name":"汽笛","design":{"audioKind":"sfx","description":"远处码头汽笛","usageInEpisode":"转场暗示","evidence":"中段"}}',
        "assets may be empty only when the material truly has no assets; never invent IDs.",
        "Do not return internal IDs, projectId, paths, base64, __proto__, or providerModelId.",
      ].join("\n");

    case "asset.design-prompt.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Single-asset mode (default): return only one continuous Chinese design-prompt paragraph.",
        "Batch mode: when user JSON includes \"output_contract\":\"ndjson\", return NDJSON only — one JSON object per line.",
        "Batch NDJSON asset line: {\"type\":\"asset\",\"asset_id\":\"...\",\"prompt\":\"完整中文生图提示词\",\"status\":\"completed\"}",
        "Batch NDJSON end line: {\"type\":\"batch_end\",\"completed_asset_ids\":[...],\"failed_asset_ids\":[],\"next_asset_id\":\"\"}",
        "No Markdown fences, headings, explanations, or blank lines between NDJSON rows.",
        "Do not output field titles like 【角色描述】【外貌】【服装】, lists, or analysis.",
        "Do not echo extract seed or English concept art fallbacks.",
      ].join("\n");

    case "text.storyboard-prompt.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object (machine envelope only). Preferred shape:",
        '{"shots":[{"shotId":"与输入一致的镜头id","videoPrompt":"该镜头完整中文视频提示词"}]}',
        "Legacy alias also accepted: {\"prompts\":[{\"shotId\":\"...\",\"videoPrompt\":\"...\"}]}",
        "shots/prompts must cover every shotId from the user input exactly once; shotId must be copied verbatim; videoPrompt must be non-empty.",
        "CRITICAL: each videoPrompt value must be the FULL shot prompt body that obeys the published task rules — including duration header (prompt design 9–15 seconds total, never exceed 15, do not pad short plots), mount tags when assets exist, scene base, standing positions, timed internal shots (size/focal/angle/move), dialogue verbatim, sound, and continuity limits.",
        "Do NOT rewrite videoPrompt into a short summary such as「景别：…运镜：…」one-liners.",
        "When two or more shots are returned, insert the required adjacent handoff card text between them by appending it to the earlier shot's videoPrompt (or prepending to the next), exactly as the task rules require.",
        "Output-format rules must NOT override or drop project visual-style constraints.",
        "No explanations, markdown fences, or meta commentary outside the JSON.",
      ].join("\n");

    case "script.outline.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return outline planning text only — not full episode scripts or shot lists.",
        "No explanations or preamble.",
      ].join("\n");

    case "story.generate":
    case "script.continue.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return story/script body text only.",
        "No explanations, preamble, or markdown code fences wrapping the full body.",
      ].join("\n");

    default:
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        `capability: ${capabilityId}`,
        "Follow the capability output format exactly; no extra commentary.",
      ].join("\n");
  }
}
