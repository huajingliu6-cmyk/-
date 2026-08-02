import type { GenerationHistoryItem } from "@/projects/story/types";

/** 本阶段 mock 历史，类型已对齐后续真实接口 */
export const MOCK_GENERATION_HISTORY: GenerationHistoryItem[] = [
  {
    id: "hist-1",
    version: 1,
    outputType: "story",
    label: "小故事",
    createdAt: "2026-07-26T10:20:00.000Z",
    summary: "雨巷旅人在霓虹路口做出选择……",
    content:
      "雨夜，霓虹把积水染成紫红色。旅人停在路口，听见远处鼓点，终于迈出第一步。",
  },
  {
    id: "hist-2",
    version: 2,
    outputType: "script",
    label: "剧本第一集",
    createdAt: "2026-07-26T14:05:00.000Z",
    summary: "第一场：雨巷口 / 人物对白草稿……",
    content:
      "场景一 外景 雨巷口 夜\n旅人：（望向霓虹）今晚，我不再回头。\n（远处鼓点渐近）",
  },
];
