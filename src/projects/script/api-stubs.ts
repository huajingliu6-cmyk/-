import type {
  EpisodeSplitConfig,
  ScriptEpisode,
  ScriptSourceFile,
} from "@/projects/script/types";

/**
 * 后续 AI / 导出接入预留。
 * 剧本目录持久化请走 PUT /api/projects/:id/script-draft。
 */

export async function parseScript(file: ScriptSourceFile): Promise<never> {
  void file;
  throw new Error("parseScript：本阶段未接入真实解析");
}

export async function convertNovelToScript(input: {
  projectId: string;
  sourceFile: ScriptSourceFile;
}): Promise<never> {
  void input;
  throw new Error("convertNovelToScript：本阶段未接入真实模型");
}

export async function splitScriptEpisodes(
  config: EpisodeSplitConfig & { projectId: string },
): Promise<never> {
  void config;
  throw new Error("splitScriptEpisodes：本阶段未接入真实模型");
}

export async function saveEpisodeContent(input: {
  projectId: string;
  episode: ScriptEpisode;
}): Promise<void> {
  void input;
  // Prefer ScriptCreationWorkspace → script-draft; kept for call-site compat.
}

export async function exportScriptToWord(input: {
  projectId: string;
  episodeIds?: string[];
}): Promise<never> {
  void input;
  throw new Error("exportScriptToWord：本阶段未实现 Word 导出");
}

export async function continueScriptGeneration(input: {
  projectId: string;
}): Promise<never> {
  void input;
  throw new Error("continueScriptGeneration：本阶段未接入真实模型");
}
