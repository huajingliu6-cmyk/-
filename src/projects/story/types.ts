/** 故事创作工作台前端类型（便于后续接真实接口） */

export type StoryOutputType = "story" | "script";

export type ScriptWorkflowMode = "discuss-outline" | "direct-episode" | null;

export type TextModelOption = {
  id: string;
  name: string;
  description: string;
};

export type GenerationHistoryItem = {
  id: string;
  version: number;
  outputType: StoryOutputType;
  /** 展示用标签，如「小故事」「剧本第一集」 */
  label: string;
  createdAt: string;
  summary: string;
  content: string;
};

export type EpisodeLengthOption = 300 | 400 | 500 | 800 | 1000;

export type StoryWorkspaceState = {
  brief: string;
  outputType: StoryOutputType;
  modelId: string;
  /** 小故事模式目标字数 */
  targetChars: number;
  scriptMode: ScriptWorkflowMode;
  episodeNumber: number;
  episodeLength: EpisodeLengthOption;
  resultText: string;
  showContinueGenerate: boolean;
  historyOpen: boolean;
  exportOpen: boolean;
  selectedExportIds: string[];
};

/** 后续 AI 接入预留 */
export type GenerateStoryParams = {
  projectId: string;
  brief: string;
  modelId: string;
  targetChars: number;
};

export type GenerateEpisodeParams = {
  projectId: string;
  brief: string;
  modelId: string;
  episodeNumber: number;
  episodeLength: EpisodeLengthOption;
};

export type ExportDocumentsParams = {
  projectId: string;
  documentIds: string[];
};
