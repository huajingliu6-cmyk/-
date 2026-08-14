export type ModelProviderMode = "mock" | "http" | "aliyun-wan27";

export type AiModality = "text" | "image" | "video" | "audio";

export type ModelConnectionPublic = {
  id: string;
  displayName: string;
  modality: AiModality;
  providerMode: ModelProviderMode;
  baseUrl: string | null;
  endpointPath?: string | null;
  modelId: string | null;
  endpointId?: string | null;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  lastTestStatus: "untested" | "testing" | "success" | "failed";
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  legacyVirtual?: boolean;
};

export type ConnectionDraft = {
  displayName: string;
  modality: AiModality;
  providerMode: ModelProviderMode;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
};

export type CapabilityRuleSummary = {
  capabilityId: string;
  label: string;
  modality: string;
  status: string;
  defaultProfileSlot: string | null;
  hasDraft: boolean;
  draftRevision: number | null;
  publishedVersion: number | null;
  publishedSource: "builtin" | "custom";
  versionCount: number;
  effectiveRulePreview: string;
  builtinRuleLength: number;
  outputContractConflict?: boolean;
  outputContractConflictMessage?: string | null;
};

export type CapabilityDiag = {
  capabilityId: string;
  label: string;
  modality: string;
  status: string;
  profileSlotId: string | null;
  profileLabel: string | null;
  health: string;
  runnable: boolean;
};

export type AiModelBinding = {
  profileSlot: string;
  modelConnectionId: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type ProfileSlotOption = {
  profileSlot: string;
  label: string;
};

export type TaskRuleDraft = {
  content: string;
  sourceType: "manual" | "markdown";
  sourceFileName: string | null;
  revision: number;
  updatedBy: string;
  updatedAt: string;
};

export type TaskRulePublishedVersion = {
  version: number;
  content: string;
  contentHash: string;
  sourceType: string;
  sourceFileName: string | null;
  publishedBy: string;
  publishedAt: string;
  rolledBackFromVersion: number | null;
};

export type RuleCheckItem = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
};

export type RuleCheckResult = {
  errors: RuleCheckItem[];
  warnings: RuleCheckItem[];
  infos: RuleCheckItem[];
};

export function capabilitySlug(capabilityId: string): string {
  return capabilityId.replace(/\./g, "-");
}

export function testStatusLabel(
  status: ModelConnectionPublic["lastTestStatus"],
): string {
  switch (status) {
    case "success":
      return "测试通过";
    case "failed":
      return "测试失败";
    case "testing":
      return "测试中";
    default:
      return "未测试";
  }
}

export function ruleStatusLabel(summary: CapabilityRuleSummary): string {
  if (summary.hasDraft) {
    return `草稿 v${summary.draftRevision ?? "?"}${
      summary.publishedSource === "builtin" && !summary.publishedVersion
        ? " · 未发布"
        : ""
    }`;
  }
  if (summary.publishedSource === "builtin" || !summary.publishedVersion) {
    return "内置规则";
  }
  return `自定义 v${summary.publishedVersion}`;
}
