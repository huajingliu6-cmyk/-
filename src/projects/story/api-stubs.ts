import type {
  ExportDocumentsParams,
  GenerateEpisodeParams,
  GenerateStoryParams,
} from "@/projects/story/types";

/**
 * 后续 AI / 导出接入预留。
 * 本阶段仅抛出明确错误，禁止调用真实模型或写文件。
 * 大纲生成已接入 text-generations（script_outline）。
 * 剧集生成已接入 text-generations（script_episodes），不再提供 generateEpisode stub。
 */

export async function generateStory(
  params: GenerateStoryParams,
): Promise<never> {
  void params;
  throw new Error(
    "generateStory stub 已停用：请通过 StoryCreationWorkspace → text-generations API",
  );
}

export async function continueGenerate(
  params: GenerateEpisodeParams,
): Promise<never> {
  void params;
  // TODO: 剧本续写接口（script.continue.generate 仍为 planned）
  throw new Error("continueGenerate：本阶段未接入真实模型");
}

export async function exportDocuments(
  params: ExportDocumentsParams,
): Promise<never> {
  void params;
  // TODO: 合并导出 Word
  throw new Error("exportDocuments：本阶段未实现 Word 导出");
}

export function switchToScriptMode(): "script" {
  return "script";
}

/** 与剧本工作台共用同一转换预留（勿复制第二套逻辑） */
export { convertNovelToScript } from "@/projects/script/api-stubs";
