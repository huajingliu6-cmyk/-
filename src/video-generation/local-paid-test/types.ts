export type LocalPaidTestGuardState =
  | "unarmed"
  | "armed"
  | "submitting"
  | "providerAccepted"
  | "transferPending"
  | "completed"
  | "failedBeforeSubmit"
  | "unknownOutcome"
  | "consumed";

export type WanLocalPaidTestGuardRecord = {
  version: 1;
  state: LocalPaidTestGuardState;
  /** 可选：关联 generation（正式或 simulation 命名空间） */
  generationId: string | null;
  providerTaskId: string | null;
  /** 安全指纹：不含 prompt / token / key */
  requestFingerprint: string | null;
  armedAt: string | null;
  updatedAt: string;
  lastErrorCode: string | null;
  /** simulation 命名空间标记 */
  simulation: boolean;
  namespace: "live" | "simulation";
};

export type LocalPaidTestPublicConfig = {
  localPaidTestModeEnabled: boolean;
  isDevelopment: boolean;
  tokenConfigured: boolean;
  priceConfirmed: boolean;
  priceConfirmedOn: string | null;
  maxCostConfigured: boolean;
  maxCostCny: number | null;
  maxTasks: number;
  providerIsAliyun: boolean;
  allowPaidGeneration: boolean;
  hasApiKey: boolean;
  hasWorkspaceId: boolean;
  region: string;
  t2vModelId: string;
  allowlistConfigured: boolean;
  hardMaxCostCny: number;
  confirmationPhraseRequired: true;
  costNotice: string;
  phaseNotice: string;
  /** 本阶段真实提交仍关闭 */
  realSubmitEnabled: false;
};

export type LocalPaidTestEnvironmentReadiness = {
  /** 仅注入合法假配置时可 true；默认运行环境应为 false */
  readyForOneShotLocalTest: boolean;
  /** 全局付费提交：默认仍 false；本阶段实际运行保持 false */
  readyForPaidSubmission: boolean;
  readyForResultTransfer: boolean;
  allowlistEmptyWarning: string | null;
  checks: Array<{
    key: string;
    status: "pass" | "fail" | "warning";
    message: string;
  }>;
  publicConfig: LocalPaidTestPublicConfig;
  guardState: LocalPaidTestGuardState;
};
