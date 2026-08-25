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
        "（已废弃）旧版一次性资产提取规则。新产品路径请分别配置 asset.roster.extract 与 asset.detail.extract。",
      ].join("\n");

    case "asset.roster.extract":
      return [
        "你是专业影视资产策划师（名单阶段）。",
        "根据用户提供的剧本分块，只发现精简资产名单：类型、名称、别名、出现证据。",
        "不要生成外观、场景细节、提示词、design 字段或任何详细设计正文。",
        "同名同类实体合并为一项，额外名称写入 aliases。",
        "只分析当前分块中出现的资产，禁止臆造未出现的名称。",
        "输出严格遵循 IMMUTABLE_OUTPUT_CONTRACT 的 roster JSON。",
      ].join("\n");

    case "asset.detail.extract":
      return [
        "你是专业影视资产策划师（详情阶段）。",
        "根据用户提供的本批资产名单与剧本证据，仅为名单中的资产生成结构化 design。",
        "禁止返回名单之外的 assetKey；禁止补充新资产。",
        "证据不足时仍返回该资产，design 可留空或稀疏，并在 evidence 中标注可用来源；不要伪造资产。",
        "usageInEpisode 必须写在 design 内。",
        "输出严格遵循 IMMUTABLE_OUTPUT_CONTRACT 的 detail JSON。",
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
        "最终 PromptClip 总时长必须为 13–15 秒（仅允许 13、14、15）。",
        "PromptClip 内部允许拆分为 3–5 个连续时间轴镜头；每个内部镜头时长为 1–6 秒，建议优先控制在 5 秒以内；任何内部镜头不得超过 6 秒。",
        "时间轴必须从 0 秒开始，连续到总时长结束；不允许时间空档、重叠或最后结束时间小于 Clip 总时长。",
        "人物站位描述为可选内容；剧本或模型没有明确站位时，不得补造虚假站位，也不得因此阻止提示词生成。",
        "每个 videoPrompt 必须自包含：分镜标题头（总时长与画幅）、挂载标签（有可用参考图时）、场景基调、人物动作与对白、分秒时间轴（景别/焦距/角度/运镜）、台词逐字、声音、连续性限制；有人物站位时写入位置结构；多镜时按规则写入相邻交接卡。",
        "禁止写成「景别：…运镜：…」一类一行摘要；禁止输出分析过程或规则编号。",
        "平台合规：videoPrompt 正文不得出现吸烟/烟草/点烟/吐烟、饮酒/酒类品牌或喝酒动作、毒品、血腥特写等易触发审核的直白描写；若剧本涉及相关情节，须改写为中性可见动作（如神情、手势、无标签饮品杯）且保留剧情张力。",
        "videoPrompt 正文不得复述任务规则中的「禁止…」「不得…」条款，不得输出改编说明、本集统计、请确认等元信息。",
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

    case "video.personal.generate":
      return [
        "根据个人中心提示词与参考图生成短视频。",
        "遵循用户选择的模型、画质、画幅比例、风格与时长。",
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
