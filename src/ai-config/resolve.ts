import {
  AI_CAPABILITIES,
  getAiCapability,
  outputKindToCapabilityId,
  profileSlotModality,
  type AiCapabilityDefinition,
  type AiCapabilityId,
} from "@/ai-config/capabilities";
import {
  AiConfigError,
  publicAiConfigErrorMessage,
  type AiCapabilityAvailability,
  type AiCapabilityBinding,
} from "@/ai-config/errors";
import {
  getCapabilityBinding,
  isPlausibleApiKey,
  listCapabilityBindings,
  listGenerationApiConfigs,
  type GenerationApiConfig,
} from "@/auth/api-config";
import {
  resolveConnectionForSlot,
  type ModelConnection,
} from "@/ai-config/model-connections";
import {
  assertSafeAiEndpointUrl,
  urlGuardOptionsForProfileSlot,
} from "@/ai-config/url-guard";

export type ResolvedAiCapabilityConfig = {
  capability: AiCapabilityDefinition;
  binding: AiCapabilityBinding;
  profile: GenerationApiConfig;
  /** Server-only secret; never serialize to clients. */
  secret: string | null;
  /** Bound model connection id when resolved via connections store. */
  modelConnectionId?: string;
};

function throwConfig(code: AiConfigError["code"]): never {
  throw new AiConfigError(code, publicAiConfigErrorMessage(code));
}

function connectionToProfile(
  slotId: NonNullable<AiCapabilityBinding["profileSlotId"]>,
  connection: ModelConnection,
): GenerationApiConfig {
  const provider =
    connection.providerMode === "http"
      ? "http"
      : connection.providerMode === "aliyun-wan27"
        ? "aliyun-wan27"
        : "mock";
  return {
    id: slotId,
    label: connection.displayName || slotId,
    description: "",
    provider,
    // HttpCompatibleTextProvider appends /chat/completions to baseUrl.
    apiUrl: (connection.baseUrl ?? "").trim(),
    apiKey: connection.apiKey ?? "",
    model: connection.modelId ?? "",
    enabled: connection.enabled,
    updatedAt: connection.updatedAt,
  };
}

/**
 * Resolve runtime config for an active capability.
 * Prefers admin「模型连接」slot bindings; falls back to legacy profile config
 * via resolveConnectionForSlot. Does not silently swap capabilities.
 */
export async function resolveAiCapabilityRuntimeConfig(
  capabilityId: AiCapabilityId,
): Promise<ResolvedAiCapabilityConfig> {
  const capability = getAiCapability(capabilityId);
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

  const binding = await getCapabilityBinding(capabilityId);
  if (!binding.enabled) {
    throwConfig("AI_CAPABILITY_DISABLED");
  }
  if (!binding.profileSlotId) {
    throwConfig("AI_CAPABILITY_NOT_CONFIGURED");
  }

  let connection: ModelConnection;
  try {
    connection = await resolveConnectionForSlot(binding.profileSlotId);
  } catch (err) {
    if (err instanceof AiConfigError) throw err;
    throwConfig("AI_CAPABILITY_NOT_CONFIGURED");
  }

  if (!connection.enabled) {
    throwConfig("AI_MODEL_CONNECTION_DISABLED");
  }
  if (connection.modality !== capability.modality) {
    throwConfig("AI_CAPABILITY_MODALITY_MISMATCH");
  }

  const profile = connectionToProfile(binding.profileSlotId, connection);
  if (profile.enabled === false) {
    throwConfig("AI_MODEL_PROFILE_DISABLED");
  }
  if (profileSlotModality(profile.id) !== capability.modality) {
    throwConfig("AI_CAPABILITY_MODALITY_MISMATCH");
  }

  if (profile.provider === "http") {
    if (!profile.apiUrl.trim()) {
      throwConfig("AI_CONFIGURATION_INVALID");
    }
    try {
      assertSafeAiEndpointUrl(
        profile.apiUrl,
        urlGuardOptionsForProfileSlot(profile.id),
      );
    } catch {
      throwConfig("AI_CONFIGURATION_INVALID");
    }
    if (!isPlausibleApiKey(profile.apiKey)) {
      throwConfig("AI_PROVIDER_CREDENTIAL_MISSING");
    }
  } else if (profile.provider === "aliyun-wan27") {
    if (!isPlausibleApiKey(profile.apiKey) && !process.env.DASHSCOPE_API_KEY) {
      throwConfig("AI_PROVIDER_CREDENTIAL_MISSING");
    }
  } else if (profile.provider !== "mock") {
    throwConfig("AI_PROVIDER_UNSUPPORTED");
  }

  return {
    capability,
    binding,
    profile,
    secret:
      profile.provider === "http" || profile.provider === "aliyun-wan27"
        ? profile.apiKey || null
        : null,
    modelConnectionId: connection.legacyVirtual ? undefined : connection.id,
  };
}

export async function resolveCapabilityForOutputKind(
  outputKind: string,
): Promise<ResolvedAiCapabilityConfig> {
  const id = outputKindToCapabilityId(outputKind);
  if (!id) {
    throw new AiConfigError(
      "AI_CAPABILITY_UNKNOWN",
      publicAiConfigErrorMessage("AI_CAPABILITY_UNKNOWN"),
    );
  }
  return resolveAiCapabilityRuntimeConfig(id);
}

export async function getCapabilityAvailability(
  capabilityId: AiCapabilityId,
): Promise<AiCapabilityAvailability> {
  const capability = getAiCapability(capabilityId);
  if (!capability) {
    return {
      capabilityId,
      available: false,
      reasonCode: "AI_CAPABILITY_UNKNOWN",
      status: "unknown",
      label: capabilityId,
    };
  }
  try {
    await resolveAiCapabilityRuntimeConfig(capabilityId);
    return {
      capabilityId,
      available: true,
      status: capability.status,
      label: capability.label,
    };
  } catch (err) {
    const code =
      err instanceof AiConfigError ? err.code : "AI_CONFIGURATION_INVALID";
    return {
      capabilityId,
      available: false,
      reasonCode: code,
      status: capability.status,
      label: capability.label,
    };
  }
}

export async function listCapabilityAvailabilities(): Promise<
  AiCapabilityAvailability[]
> {
  const bindings = await listCapabilityBindings();
  const out: AiCapabilityAvailability[] = [];
  for (const b of bindings) {
    out.push(await getCapabilityAvailability(b.capabilityId));
  }
  return out;
}

/** Admin-facing diagnostic without secrets. */
export async function listAdminCapabilityDiagnostics() {
  const configs = await listGenerationApiConfigs();
  const bindings = await listCapabilityBindings();
  return AI_CAPABILITIES.filter((cap) => cap.status !== "deprecated").map(
    (cap) => {
      const binding = bindings.find((b) => b.capabilityId === cap.id);
      const profile = binding?.profileSlotId
        ? configs.find((c) => c.id === binding.profileSlotId)
        : null;
      let health = "未配置";
      if (cap.status === "planned") health = "功能尚未接线";
      else if (!binding?.enabled) health = "capability 禁用";
      else if (!binding.profileSlotId) health = "未绑定";
      else if (!profile) health = "模型缺失";
      else if (profile.enabled === false) health = "模型禁用";
      else if (profile.provider === "http" && !isPlausibleApiKey(profile.apiKey)) {
        health = "缺少凭据";
      } else if (profile.legacyPlaintextSecret) {
        health = "已配置（旧版明文，请配置加密主密钥后重新保存）";
      } else if (profile.provider === "mock") health = "已配置（mock）";
      else health = "已配置";

      return {
        capabilityId: cap.id,
        label: cap.label,
        modality: cap.modality,
        status: cap.status,
        classification: cap.classification,
        surface: cap.surface,
        buttonText: cap.buttonText,
        bindingEnabled: binding?.enabled ?? false,
        profileSlotId: binding?.profileSlotId ?? null,
        profileLabel: profile?.label ?? null,
        provider: profile?.provider ?? null,
        hasApiKey: profile ? isPlausibleApiKey(profile.apiKey) : false,
        health,
        runnable: cap.status === "active" && health.startsWith("已配置"),
      };
    },
  );
}
