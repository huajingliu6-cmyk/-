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
        "DEPRECATED: use asset.roster.extract and asset.detail.extract instead.",
        "Return exactly one JSON object (no markdown outside an optional single json fence):",
        '{"version":1,"assets":[ ... ]}',
        "Each asset MUST include type and name. Preferred types: character | scene | prop | audio.",
        "Put usageInEpisode INSIDE design (not only at the top level).",
      ].join("\n");

    case "asset.roster.extract":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object (no markdown outside an optional single json fence):",
        '{"version":1,"assets":[{"assetKey":"character_zhangsan","type":"character|scene|prop|audio","name":"非空名称","aliases":["可选别名"],"episodeIds":["episode_1"],"evidenceRefs":["episode_1:scene_3"]}]}',
        "Roster phase ONLY: discover slim asset names/types/aliases/evidence. Do NOT return design, appearance, clothing, location, style, usageInEpisode, description, or image/prompt text.",
        "Merge same-type same-entity aliases into one item. assetKey, type, and name are required.",
        "aliases, episodeIds, and evidenceRefs may be empty arrays.",
        "Only list assets appearing in the current script chunk. Do not invent absent names.",
      ].join("\n");

    case "asset.detail.extract":
      return [
        "[IMMUTABLE_OUTPUT_CONTRACT]",
        `version: ${OUTPUT_CONTRACT_VERSION}`,
        "Return exactly one JSON object (no markdown outside an optional single json fence):",
        '{"version":1,"assets":[{"assetKey":"character_zhangsan","type":"character|scene|prop|audio","name":"名称","design":{},"evidence":["episode_1:scene_3"]]}',
        "Detail phase ONLY: return assets whose assetKey appears in the provided batch list.",
        "Each returned asset MUST copy assetKey verbatim from the batch. Do not invent assets outside the batch.",
        "type, name, and assetKey are required. design is structured per asset type; evidence may cite script sources.",
        "When evidence is insufficient, still return the asset with sparse design and cite available evidence — do not fabricate assets.",
        "Put usageInEpisode INSIDE design (not only at the top level).",
        "For type=character: design.description MUST be a single 16:9 hyper-realistic character setting-card prompt.",
        "Layout: left 1/3 ultra-HD face close-up (hairline to chin, direct eye contact); right 2/3 three aligned full-body views (Front / strict 90° Profile / Back) of THE SAME SINGLE character on pure white seamless background.",
        "SINGLE-PERSON ONLY (highest priority, character only): the entire image shows exactly one human figure — the requested character version.",
        "NEVER describe, imply, or allow in character design: 双人, 多人, 群像, 同框他人, 并排两人, 情侣并肩, 对话构图, 镜像分身, 重复人物, 背景路人, 剪影第二人, or any phrasing that could render 2+ human figures.",
        "Right-side three views are one character from three angles — NOT two people. Empty hands, no props.",
        "Append these negative constraints verbatim at the end of every character design.description:",
        "无第二人物、无双人、无多人、无群像、无同框他人、无背景路人、无镜像重复、无分身、无对话构图、无情侣并肩、无并排两人、无其他人物、无道具、双手空置、无环境、无文字、无logo、无水印、无裁切、无变脸、无年龄漂移、无多余肢体、无3D/CG/动漫风格",
        "For type=scene: design.description MUST be a 16:9 hyper-realistic environment establishing-shot prompt (no people).",
        "Required design fields: location, timeOfDay, style, usageInEpisode, evidence, description.",
        "Append at end of scene design.description: 无人物、无路人、无剪影、无文字、无logo、无水印、无裁切、无3D/CG/动漫风格、无过度饱和、无塑料感",
        "For type=prop: design.description MUST be a 16:9 hyper-realistic still-life / product-shot prompt (no people, no hands).",
        "Required design fields: propType, usage, usageInEpisode, evidence, description.",
        "Append at end of prop design.description: 无人物、无人手、无文字、无logo、无水印、无裁切、无3D/CG/动漫风格、无过度饱和、无塑料感、无杂乱背景",
        "Full examples:",
        '{"assetKey":"character:linqing","type":"character","name":"林清","design":{"appearance":"28岁","clothing":"风衣","role":"主角","usageInEpisode":"开场","evidence":"第一场","description":"16:9横屏…（单人设定卡完整提示词，末尾含上述负面约束）"},"evidence":["第一场"]}',
        '{"assetKey":"scene:jiangbianmatou","type":"scene","name":"江边码头","design":{"location":"夜色江岸","timeOfDay":"夜","style":"写实冷调","usageInEpisode":"高潮","evidence":"末场","description":"16:9横屏环境建立镜头…（末尾含场景负面约束）"},"evidence":["末场"]}',
        '{"assetKey":"prop:jiusan","type":"prop","name":"旧伞","design":{"propType":"随身道具","usage":"信物","usageInEpisode":"第2场","evidence":"第2场","description":"16:9横屏道具静物…（末尾含道具负面约束）"},"evidence":["第2场"]}',
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
        "protocol: SHOT_ID_PROMPT_V1",
        "Planning mode (no input shotIds): return",
        '{"shots":[{"sceneTitle":"...","sourceScriptText":"...","videoPrompt":"完整未压缩正文","dialogue":"..."}],"done":boolean}',
        `At most 3 shots per response; set done=true when the episode is fully covered.`,
        "Fill mode (input shotIds present): return",
        '{"shots":[{"shotId":"输入shotId原样","videoPrompt":"完整未压缩正文"}]}',
        "Legacy alias also accepted: {\"prompts\":[{\"shotId\":\"...\",\"videoPrompt\":\"...\"}]}",
        "Platform only materializes returned rows — it does not invent shot boundaries.",
        "videoPrompt MUST be the full prompt body required by the task rule (e.g. complete PromptClip with timeline/modules).",
        "Do NOT compress, summarize, paraphrase-shorten, or collapse videoPrompt into short paragraphs.",
        "Do NOT pack multiple clips into one videoPrompt as 「镜头1/2/3」 shorthand.",
        "Only prior-batch continuity context may be brief; never the videoPrompt body.",
        "No Markdown fences, analysis, or commentary outside the JSON.",
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
