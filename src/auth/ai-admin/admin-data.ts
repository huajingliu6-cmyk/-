import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
  ModelConnectionPublic,
  ProfileSlotOption,
} from "@/auth/ai-admin/types";

export type CapabilityBindingPublic = {
  capabilityId: string;
  profileSlotId: string | null;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type ProfileConfigPublic = {
  id: string;
  label: string;
  description: string;
  provider: string;
  apiUrl: string;
  model: string;
  enabled?: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  modality: "text" | "image" | "video" | "audio";
  legacyPlaintextSecret: boolean;
  updatedAt: string;
};

export type AdminAiData = {
  connections: ModelConnectionPublic[];
  slotBindings: AiModelBinding[];
  slots: ProfileSlotOption[];
  capabilityBindings: CapabilityBindingPublic[];
  capabilities: CapabilityDiag[];
  profiles: ProfileConfigPublic[];
  rules: CapabilityRuleSummary[];
};

async function readPayload<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `请求失败（${response.status}）`);
  }
  return payload;
}

export async function loadAdminAiData(): Promise<AdminAiData> {
  const [connectionsRes, slotBindingsRes, configsRes, rulesRes] =
    await Promise.all([
      fetch("/api/admin/model-connections", { cache: "no-store" }),
      fetch("/api/admin/ai-model-bindings", { cache: "no-store" }),
      fetch("/api/admin/api-configs", { cache: "no-store" }),
      fetch("/api/admin/ai-task-rules", { cache: "no-store" }),
    ]);

  const [connectionsPayload, slotBindingsPayload, configsPayload, rulesPayload] =
    await Promise.all([
      readPayload<{ connections?: ModelConnectionPublic[] }>(connectionsRes),
      readPayload<{
        bindings?: AiModelBinding[];
        slots?: ProfileSlotOption[];
      }>(slotBindingsRes),
      readPayload<{
        configs?: ProfileConfigPublic[];
        bindings?: CapabilityBindingPublic[];
        capabilities?: CapabilityDiag[];
      }>(configsRes),
      readPayload<{ capabilities?: CapabilityRuleSummary[] }>(rulesRes),
    ]);

  return {
    connections: connectionsPayload.connections ?? [],
    slotBindings: slotBindingsPayload.bindings ?? [],
    slots: slotBindingsPayload.slots ?? [],
    capabilityBindings: configsPayload.bindings ?? [],
    capabilities: configsPayload.capabilities ?? [],
    profiles: configsPayload.configs ?? [],
    rules: rulesPayload.capabilities ?? [],
  };
}

export function modalityLabel(modality: string): string {
  if (modality === "text") return "文本";
  if (modality === "image") return "图像";
  if (modality === "audio") return "音频";
  if (modality === "video") return "视频";
  return modality;
}

export function providerLabel(provider: string): string {
  if (provider === "http") return "HTTP / OpenAI 兼容";
  if (provider === "aliyun-wan27") return "阿里云万相";
  if (provider === "mock") return "本地 Mock";
  return provider;
}

export function connectionHost(baseUrl: string | null): string {
  if (!baseUrl) return "本地演示";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
