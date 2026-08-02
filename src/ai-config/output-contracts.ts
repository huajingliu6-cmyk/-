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
        "Return exactly one JSON object:",
        '{"version":1,"assets":[{"type":"character|scene|prop|audio","name":"非空名称","description":"可选","design":{...},"evidence":"可选"}]}',
        "assets may be empty; each item requires type and name.",
        "Do not return internal IDs, projectId, paths, or base64.",
      ].join("\n");

    case "asset.design-prompt.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return only the final design prompt text in Chinese.",
        "No explanations, markdown fences, or meta commentary.",
      ].join("\n");

    case "text.storyboard-prompt.generate":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object (machine envelope only):",
        '{"prompts":[{"shotId":"与输入一致的镜头id","videoPrompt":"该镜头完整中文视频提示词"}]}',
        "prompts must cover every shotId from the user input exactly once.",
        "CRITICAL: each videoPrompt value must be the FULL shot prompt body that obeys the published task rules — including duration header, mount tags when assets exist, scene base, standing positions, timed internal shots (size/focal/angle/move), dialogue verbatim, sound, and continuity limits.",
        "Do NOT rewrite videoPrompt into a short summary such as「景别：…运镜：…」one-liners.",
        "When two or more shots are returned, insert the required adjacent handoff card text between them by appending it to the earlier shot's videoPrompt (or prepending to the next), exactly as the task rules require.",
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
