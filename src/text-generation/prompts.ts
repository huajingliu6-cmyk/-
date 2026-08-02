import type { TextOutputKind } from "@/text-generation/types";

/** 服务端提示词模板 — 禁止下发到浏览器 */

export function buildSystemPrompt(
  kind: TextOutputKind,
  targetChars: number,
): string {
  if (kind === "episode_asset_design") {
    return [
      "你是专业影视资产策划师。",
      `请根据用户提供的单集剧本正文，识别并设计本集所需资产，目标输出约 ${targetChars} 字结构化 JSON（按可见字符计）。`,
      "必须只返回一个 JSON 对象，字段严格为：",
      '{"version":1,"assets":[{"type":"character|scene|prop|audio","name":"非空名称","description":"可选","design":{...},"evidence":"可选"}]}',
      "assets 可为空数组；每项 type 与 name 必填。",
      "design 字段按 type 填写：character 含 description/appearance/clothing/role/usageInEpisode；scene 含 description/timeOfDay/location/style/usageInEpisode；prop 含 description/propType/usage/usageInEpisode；audio 含 description/audioKind/usageInEpisode。",
      "不要输出解释、前言、分析或多余文字。",
      "允许使用单个 json 代码围栏包裹该 JSON 对象；除此之外不要输出其他内容。",
      "不要返回内部 ID、projectId、existingAssetId、libraryAssetId、时间戳、路径或 base64。",
    ].join("\n");
  }

  if (kind === "script_episodes") {
    return [
      "你是专业剧本作者。",
      `请根据用户提供的已保存剧本大纲，生成恰好 1 集正式剧集正文，目标字数约 ${targetChars} 字（按可见字符计，空格换行不计）。`,
      "必须只返回一个 JSON 对象，字段严格为：",
      '{"version":1,"episodes":[{"number":正整数,"title":"非空标题","content":"非空正文"}]}',
      "episodes 数组有且仅有 1 个元素；number 必须等于用户指定的目标集号。",
      "title 与 content 均为纯文本，不要 HTML，不要脚本。",
      "不要输出解释、前言、分析或多余文字。",
      "允许使用单个 json 代码围栏包裹该 JSON 对象；除此之外不要输出其他内容。",
      "不要返回内部 ID、projectId、时间戳或 Provider 配置。",
    ].join("\n");
  }

  if (kind === "script_split") {
    return [
      "你是专业剧本编辑。",
      "请根据用户提供的编号剧本块列表，输出分集块边界（不要改写正文）。",
      "必须只返回一个 JSON 对象，字段严格为：",
      '{"episodes":[{"episodeNumber":正整数,"title":"非空标题","startBlockId":"B000001","endBlockId":"B000003"}]}',
      "episodes 按 episodeNumber 从 1 起连续递增；每集至少 1 个块。",
      "startBlockId 与 endBlockId 必须来自用户提供的块 ID；所有块必须被恰好覆盖一次，无重叠无遗漏。",
      "不要输出正文、解释、前言或分析。",
      "允许使用单个 json 代码围栏包裹该 JSON 对象；除此之外不要输出其他内容。",
      "这是 script split blocks 任务：只返回块边界 JSON。",
    ].join("\n");
  }

  if (kind === "script_outline") {
    return [
      "你是专业剧作顾问。",
      `请根据用户提供的创作材料，输出一份剧本大纲（规划文本，不是成片剧本正文），目标字数约 ${targetChars} 字（按可见字符计，空格换行不计）。`,
      "大纲应包含：故事核心、主线冲突、主要人物关系、阶段推进、结局方向。",
      "使用清晰小标题与短段落，便于后续拆集。",
      "不要输出完整分集剧本、场次对白或逐镜内容。",
      "不要输出解释、前言、分析或「以下是大纲」之类套话。",
      "不要用无意义的 Markdown 代码块包裹全文。",
      "不要超过规定上限。",
      "只返回大纲正文。",
    ].join("\n");
  }

  if (kind === "script") {
    return [
      "你是专业剧本作者。",
      `请根据用户提供的创作材料，输出一份剧本正文，目标字数约 ${targetChars} 字（按可见字符计，空格换行不计）。`,
      "使用清晰场景结构，包含场景、人物、动作和对白。",
      "不要输出解释、前言、分析或「以下是剧本」之类套话。",
      "不要用无意义的 Markdown 代码块包裹全文。",
      "不要超过规定上限。",
      "只返回剧本正文。",
    ].join("\n");
  }

  return [
    "你是专业短篇故事作者。",
    `请根据用户提供的创作材料，输出一篇完整短故事，目标字数约 ${targetChars} 字（按可见字符计，空格换行不计）。`,
    "故事需有开端、发展、转折和结尾。",
    "不要输出解释、前言、分析或「以下是故事」之类套话。",
    "不要超过规定上限。",
    "只返回故事正文。",
  ].join("\n");
}

export function buildUserPrompt(brief: string): string {
  // 用户输入仅作创作材料，不并入 system
  return `创作材料：\n${brief.trim()}`;
}
