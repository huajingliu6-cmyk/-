import { createHash } from "crypto";
import {
  getAiCapability,
  type AiCapabilityDefinition,
  type AiCapabilityId,
} from "@/ai-config/capabilities";
import { OUTPUT_CONTRACT_VERSION } from "@/ai-config/output-contracts";
import {
  AiConfigError,
  publicAiConfigErrorMessage,
} from "@/ai-config/errors";
import {
  resolveConnectionForSlot,
  type ModelConnectionPublic,
} from "@/ai-config/model-connections";
import { assembleTextSystemPrompt } from "@/ai-config/prompt-assembly";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getCapabilityBinding } from "@/auth/api-config";
import {
  buildPlatformSystemPolicy,
  SYSTEM_POLICY_VERSION,
} from "@/ai-config/system-policy";
import {
  getEffectivePublishedRule,
  type EffectivePublishedRule,
} from "@/ai-config/task-rules-store";
import {
  AI_TASK_RULE_CONTRACT_CONFLICT_USER_MESSAGE,
  findTaskRuleOutputContractConflict,
} from "@/ai-config/task-rule-contract-guard";
import { migrateMisboundEpisodeDesignTaskRules } from "@/ai-config/migrate-misbound-episode-design-rules";
import { toPublicConfig } from "@/auth/api-config";
import { listConnectionsPublic } from "@/ai-config/model-connections";

export type AiExecutionPlanModelConnection = {
  id: string;
  displayName: string;
  modality: string;
  providerMode: string;
  modelId: string | null;
  enabled: boolean;
};

export type AiExecutionPlan = {
  capability: AiCapabilityDefinition;
  modelConnection: AiExecutionPlanModelConnection;
  taskRule: EffectivePublishedRule;
  systemPolicyVersion: string;
  outputContractVersion: string;
  systemPrompt: string;
  dynamicInput: unknown;
  inputFingerprint: string;
};

export type ResolveAiExecutionPlanInput = {
  capabilityId: AiCapabilityId;
  projectId?: string;
  userId?: string;
  dynamicInput?: unknown;
  dynamicInputFingerprint?: string;
  targetChars?: number;
};

function throwConfig(code: AiConfigError["code"]): never {
  throw new AiConfigError(code, publicAiConfigErrorMessage(code));
}

function computeInputFingerprint(
  capabilityId: AiCapabilityId,
  dynamicInput: unknown,
  projectId?: string,
): string {
  const payload = JSON.stringify({
    capabilityId,
    projectId: projectId ?? null,
    dynamicInput,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function toPlanModelConnection(
  conn: Awaited<ReturnType<typeof resolveConnectionForSlot>>,
): AiExecutionPlanModelConnection {
  return {
    id: conn.id,
    displayName: conn.displayName,
    modality: conn.modality,
    providerMode: conn.providerMode,
    modelId: conn.modelId,
    enabled: conn.enabled,
  };
}

export async function resolveAiExecutionPlan(
  input: ResolveAiExecutionPlanInput,
): Promise<AiExecutionPlan> {
  const capability = getAiCapability(input.capabilityId);
  if (!capability) {
    throwConfig("AI_CAPABILITY_UNKNOWN");
  }
  if (capability.status === "planned") {
    throwConfig("AI_CAPABILITY_PLANNED");
  }
  if (capability.status === "deprecated") {
    throwConfig("AI_CAPABILITY_DEPRECATED");
  }
  if (capability.status !== "active") {
    throwConfig("AI_CAPABILITY_DISABLED");
  }

  const binding = await getCapabilityBinding(input.capabilityId);
  if (!binding.enabled) {
    throwConfig("AI_CAPABILITY_DISABLED");
  }
  if (!binding.profileSlotId) {
    throwConfig("AI_MODEL_UNBOUND");
  }

  let connection: Awaited<ReturnType<typeof resolveConnectionForSlot>>;
  try {
    connection = await resolveConnectionForSlot(binding.profileSlotId);
  } catch (err) {
    if (err instanceof AiConfigError) throw err;
    throwConfig("AI_MODEL_UNBOUND");
  }

  if (!connection.enabled) {
    throwConfig("AI_MODEL_CONNECTION_DISABLED");
  }

  const supported = new Set(["mock", "http", "aliyun-wan27"]);
  if (!supported.has(connection.providerMode)) {
    throwConfig("AI_MODEL_ADAPTER_UNAVAILABLE");
  }

  if (
    (connection.providerMode === "http" ||
      connection.providerMode === "aliyun-wan27") &&
    !connection.apiKey?.trim()
  ) {
    throwConfig("AI_MODEL_SECRET_MISSING");
  }

  if (input.capabilityId === "asset.episode-design.generate") {
    try {
      await migrateMisboundEpisodeDesignTaskRules();
    } catch (err) {
      console.warn(
        "[ai-task-rule-migration] episode-design repair failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  let taskRule: EffectivePublishedRule;
  try {
    taskRule = await getEffectivePublishedRule(input.capabilityId);
  } catch (err) {
    if (err instanceof AiConfigError && err.code === "AI_TASK_RULE_CONFIG_INVALID") {
      throw err;
    }
    throwConfig("AI_TASK_RULE_CONFIG_INVALID");
  }

  const contractConflict = findTaskRuleOutputContractConflict(
    input.capabilityId,
    taskRule.content,
  );
  if (contractConflict) {
    console.warn(
      JSON.stringify({
        event: "AI_TASK_RULE_CONTRACT_CONFLICT",
        capabilityId: input.capabilityId,
        bindingProfileSlotId: binding.profileSlotId,
        taskRuleSource: taskRule.source,
        taskRuleId: `${input.capabilityId}:${taskRule.version ?? "builtin"}`,
        taskRuleVersion: taskRule.version,
        taskRuleHash: taskRule.contentHash.slice(0, 16),
        generationId: null,
        conflictPatterns: contractConflict.patterns,
      }),
    );
    throw new AiConfigError(
      "AI_TASK_RULE_CONTRACT_CONFLICT",
      AI_TASK_RULE_CONTRACT_CONFLICT_USER_MESSAGE,
    );
  }

  const systemPolicy = buildPlatformSystemPolicy(input.capabilityId);
  const outputContract = buildImmutableOutputContract(input.capabilityId);
  const systemPrompt = assembleTextSystemPrompt({
    systemPolicy,
    taskRule: taskRule.content,
    taskRuleSource: taskRule.source,
    outputContract,
    targetChars: input.targetChars,
  });

  const dynamicInput = input.dynamicInput ?? null;
  const inputFingerprint =
    input.dynamicInputFingerprint ??
    computeInputFingerprint(
      input.capabilityId,
      dynamicInput,
      input.projectId,
    );

  return {
    capability,
    modelConnection: toPlanModelConnection(connection),
    taskRule,
    systemPolicyVersion: SYSTEM_POLICY_VERSION,
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    systemPrompt,
    dynamicInput,
    inputFingerprint,
  };
}

/** Admin helper: list public connections + legacy profile configs. */
export async function listAdminModelConnectionOptions(): Promise<{
  connections: ModelConnectionPublic[];
  legacyProfiles: ReturnType<typeof toPublicConfig>[];
}> {
  const { listGenerationApiConfigs } = await import("@/auth/api-config");
  const configs = await listGenerationApiConfigs();
  return {
    connections: await listConnectionsPublic(),
    legacyProfiles: configs.map(toPublicConfig),
  };
}
