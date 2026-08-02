export type TextOutputKind =
  | "story"
  | "script"
  | "script_outline"
  | "script_episodes"
  | "script_split"
  | "episode_asset_design"
  | "asset_design_prompt"
  | "storyboard_prompt";

export type TextGenerationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TextGenerationJob = {
  generationId: string;
  projectId: string;
  userId: string;
  outputKind: TextOutputKind;
  modelKey: string;
  displayModelName: string;
  providerModelId: string;
  brief: string;
  targetChars: number;
  status: TextGenerationStatus;
  content: string;
  actualChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reservedPoints: number;
  chargedPoints: number;
  idempotencyKey: string;
  documentId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** H2 runtime composition metadata (optional, backward compatible). */
  capabilityId?: string;
  taskRuleSource?: "builtin" | "custom";
  taskRuleVersion?: number | null;
  taskRuleHash?: string;
  modelConnectionId?: string | null;
  systemPolicyVersion?: string;
  outputContractVersion?: string;
  inputFingerprint?: string;
};

export type ProjectTextDocument = {
  documentId: string;
  projectId: string;
  rootFolderId: string;
  documentType: TextOutputKind;
  title: string;
  content: string;
  version: number;
  createdBy: string;
  modelKey: string;
  providerModel: string;
  targetChars: number;
  actualChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  generationId: string;
  createdAt: string;
};

export type StoryDraft = {
  projectId: string;
  brief: string;
  outputKind: TextOutputKind;
  modelKey: string;
  targetChars: number;
  updatedAt: string;
  /** 工作台结果区文稿（可选） */
  resultText?: string;
  /** 剧本子流程：讨论大纲 / 直生剧集 */
  scriptMode?: "discuss-outline" | "direct-episode" | null;
  episodeNumber?: number;
  episodeLength?: number;
};

export type ProviderTextStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "usage";
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { type: "done" }
  | { type: "error"; code: string; message: string };
