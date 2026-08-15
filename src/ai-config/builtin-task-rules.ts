import type { AiCapabilityId } from "@/ai-config/capabilities";

export const OUTPUT_CONTRACT_VERSION = "1";

/** Built-in operational task guidance — used when no admin-published rule exists. */

export function getBuiltinTaskRule(capabilityId: AiCapabilityId): string {
  switch (capabilityId) {
    case "story.generate":
      return [
        "你是专业短篇故事作者。",
        "根据用户提供的创作材料，输出一篇完整短故事。",
        "故事需有开端、发展、转折和结尾。",
      ].join("\n");

    case "script.outline.generate":
      return [
        "你是专业剧作顾问。",
        "根据用户提供的创作材料，输出一份剧本大纲（规划文本，不是成片剧本正文）。",
        "大纲应包含：故事核心、主线冲突、主要人物关系、阶段推进、结局方向。",
        "使用清晰小标题与短段落，便于后续拆集。",
      ].join("\n");

    case "script.episodes.generate":
      return [
        "你是专业剧本作者。",
        "根据用户提供的已保存剧本大纲，生成恰好 1 集正式剧集正文。",
        "使用清晰场景结构，包含场景、人物、动作和对白。",
      ].join("\n");

    case "script.split.generate":
      return [
        "你是专业剧本编辑。",
        "根据用户提供的编号剧本块列表，输出分集块边界（不要改写正文）。",
        "标题应简洁反映本集内容；分集节奏尽量均衡，避免单集过短或过长。",
        "硬边界与 JSON 格式要求见 IMMUTABLE_OUTPUT_CONTRACT。",
      ].join("\n");

    case "asset.episode-design.generate":
      return [
        "你是专业影视资产策划师。",
        "根据用户提供的剧本材料识别并设计所需资产；材料可能是完整剧本、剧本分块，或用于补漏的单集正文。",
        "只分析当前材料中出现的资产；同名同类资产在本响应内合并。",
        "每项资产需有清晰 design 对象；usageInEpisode 必须写在 design 内。",
        "输出严格遵循 IMMUTABLE_OUTPUT_CONTRACT 的 JSON 示例（character/scene/prop/audio）。",
      ].join("\n");

    case "asset.design-prompt.generate":
      return [
        "你是影视美术提示词助手。",
        "根据结构化资产事实、本集剧情和用户要求，输出可直接用于素材生成的中文提示词。",
        "提示词应自然描述主体、外观、材质、服装、环境、构图、光线、镜头质感和必要的剧情用途。",
        "单资产模式：只返回一整段最终提示词正文；禁止 Markdown、字段标题、分析过程或分段摘要。",
        "批量模式（用户 JSON 含 output_contract=ndjson）：严格按 NDJSON 逐行输出，每资产一行 JSON，全部完成后输出 batch_end；禁止 Markdown、空行或解释。",
        "允许超写实真人影视摄影质感，但人物必须是虚构角色，不得复刻现实中可识别的具体个人。",
      ].join("\n");

    case "text.storyboard-prompt.generate":
      return [
        "你是专业影视分镜导演。",
        "根据用户提供的本集剧本、画幅与人物/场景/道具等素材，为每个镜头撰写可直接用于 AI 视频生成的完整中文分镜提示词。",
        "每个分镜总时长必须在 9—15 秒（含）之间，且不得超过 15 秒；按剧情与信息量合理安排，内容少就用较短时长（可低至 9 秒），禁止为凑时长注水、拖镜或硬拉长。",
        "每个 videoPrompt 必须自包含：分镜标题头（总时长与画幅）、挂载标签（有素材时）、场景基调、人物与站位、分秒时间轴（景别/焦距/角度/运镜）、台词逐字、声音、连续性限制；多镜时按规则写入相邻交接卡。",
        "禁止写成「景别：…运镜：…」一类一行摘要；禁止输出分析过程或规则编号。",
      ].join("\n");

    case "script.continue.generate":
      return [
        "你是专业剧本作者。",
        "根据用户提供的已有正文与续写要求，续写剧本正文。",
        "保持人物、语气与叙事风格一致。",
      ].join("\n");

    case "image.character.generate":
      return [
        "生成角色外貌参考图。",
        "突出人物面部、体态、服装与可识别特征。",
        "不要生成场景全景或无关道具为主体。",
      ].join("\n");

    case "image.scene.generate":
      return [
        "生成场景环境参考图。",
        "突出空间布局、光影、时代感与氛围。",
      ].join("\n");

    case "image.prop.generate":
      return [
        "生成道具参考图。",
        "突出道具形态、材质、尺寸感与用途。",
      ].join("\n");

    case "audio.character-voice.generate":
      return [
        "生成角色声音样本。",
        "遵循用户确认后的音色、语速与情绪描述。",
      ].join("\n");

    case "video.storyboard-shot.generate":
      return [
        "根据分镜镜头信息与参考素材，生成单镜视频。",
        "遵循镜头描述、画幅比例与运动方式。",
      ].join("\n");

    case "video.storyboard-episode.generate":
      return [
        "根据整集分镜序列生成集级视频。",
        "保持镜头间风格与角色一致性。",
      ].join("\n");

    case "video.workflow-node.generate":
      return [
        "根据工作流视频节点输入，生成短片片段。",
        "使用用户确认后的提示词与参考图。",
      ].join("\n");

    case "video.reference-image.precheck":
      return [
        "判断参考图是否疑似真人照片，是否可能被 Seedance 输入审核拒绝。",
        "只输出 JSON：status 与简短中文 reason。",
      ].join("\n");

    default:
      return [
        "Execute the bound AI capability task using the provided project data.",
        `Capability: ${capabilityId}`,
      ].join("\n");
  }
}
