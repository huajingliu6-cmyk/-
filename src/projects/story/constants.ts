import type { EpisodeLengthOption, TextModelOption } from "@/projects/story/types";
import { countVisibleChars } from "@/text-generation/char-count";
import {
  DEFAULT_TARGET_CHARS,
  TARGET_CHARS_MAX,
  TARGET_CHARS_MIN,
} from "@/text-generation/char-count";

/** 工作台灵感输入上限（前端）；服务端 BRIEF_MAX_CHARS=3000 */
export const STORY_BRIEF_MAX_CHARS = 1500;

/** Align with text-generations API isValidTargetChars */
export const STORY_TARGET_CHARS_MIN = TARGET_CHARS_MIN;
export const STORY_TARGET_CHARS_MAX = TARGET_CHARS_MAX;
export const STORY_TARGET_CHARS_DEFAULT = DEFAULT_TARGET_CHARS;

export const EPISODE_LENGTH_OPTIONS: EpisodeLengthOption[] = [
  300,
  400,
  500,
  800,
  1000,
];

/**
 * Story mode models must use server publicKey (GET /api/text-models).
 * Script stubs may still list display-only options.
 */
export const STORY_TEXT_MODELS: TextModelOption[] = [
  {
    id: "balanced-default",
    name: "均衡模型",
    description: "推荐，质量和成本平衡",
  },
];

/** @deprecated Prefer STORY_TEXT_MODELS for story generation */
export const MOCK_TEXT_MODELS: TextModelOption[] = [
  ...STORY_TEXT_MODELS,
  {
    id: "fast",
    name: "快速创作模型",
    description: "适合快速生成短故事，响应速度快",
  },
  {
    id: "pro-story",
    name: "专业故事模型",
    description: "适合人物关系和复杂剧情生成",
  },
  {
    id: "film-script",
    name: "影视剧本模型",
    description: "适合多场景剧本创作",
  },
];

export { countVisibleChars };
