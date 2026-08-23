import { promises as fs } from "fs";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  AI_CAPABILITIES,
  getAiCapability,
  profileSlotModality,
  type AiCapabilityId,
  type AiModelProfileSlotId,
} from "@/ai-config/capabilities";
import type { AiCapabilityBinding } from "@/ai-config/errors";
import { assertSafeAiEndpointUrl, urlGuardOptionsForProfileSlot } from "@/ai-config/url-guard";
import {
  isEncryptedSecret,
  resolveStoredApiKey,
  sealApiKeyForStorage,
  AiSecretCryptoError,
} from "@/ai-config/secret-crypto";
import {
  isRemoteDataOnly,
  requestRemoteData,
} from "@/persistence/remote-data-client";

export type GenerationApiId = AiModelProfileSlotId;

export type GenerationApiProvider = "mock" | "http" | "aliyun-wan27";

export type GenerationApiConfig = {
  id: GenerationApiId;
  label: string;
  description: string;
  provider: GenerationApiProvider;
  apiUrl: string;
  /** In-memory plaintext after decrypt; never write raw to clients. */
  apiKey: string;
  /** 可选：模型名 / 方舟接入点 ID（视频镜头 HTTP 必填） */
  model: string;
  /** When false, profile cannot be used by resolver. Default true. */
  enabled?: boolean;
  /** Disk still holds legacy plaintext until admin re-saves. */
  legacyPlaintextSecret?: boolean;
  /** Encrypted on disk but master key missing/wrong — cannot run. */
  secretUnavailable?: boolean;
  updatedAt: string;
};

export type GenerationApiConfigPublic = Omit<GenerationApiConfig, "apiKey"> & {
  hasApiKey: boolean;
  apiKeyMasked: string;
  modality: "text" | "image" | "video" | "audio";
  legacyPlaintextSecret: boolean;
};

function normalizeProvider(
  raw: string | undefined,
  slotId: GenerationApiId,
): GenerationApiProvider {
  if (raw === "http") return "http";
  if (raw === "aliyun-wan27" && slotId === "video-shot") return "aliyun-wan27";
  return "mock";
}

function materializeStoredKey(stored: string): {
  apiKey: string;
  legacyPlaintextSecret: boolean;
  secretUnavailable: boolean;
} {
  if (!stored) {
    return { apiKey: "", legacyPlaintextSecret: false, secretUnavailable: false };
  }
  if (isEncryptedSecret(stored)) {
    try {
      const resolved = resolveStoredApiKey(stored);
      return {
        apiKey: resolved.plaintext,
        legacyPlaintextSecret: false,
        secretUnavailable: false,
      };
    } catch {
      return {
        apiKey: "",
        legacyPlaintextSecret: false,
        secretUnavailable: true,
      };
    }
  }
  return {
    apiKey: stored,
    legacyPlaintextSecret: true,
    secretUnavailable: false,
  };
}

type ApiConfigFile = {
  version: 1 | 2;
  configs: GenerationApiConfig[];
  bindings?: AiCapabilityBinding[];
  audit?: Array<{
    id: string;
    action: string;
    capabilityId?: string;
    profileSlotId?: string;
    changedFields: string[];
    updatedBy: string;
    updatedAt: string;
  }>;
};


function configFilePath(): string {
  return resolveAppDataPath("generation-api-configs.json");
}

export const GENERATION_API_DEFS: Array<{
  id: GenerationApiId;
  label: string;
  description: string;
  envProvider: string[];
  envUrl: string[];
  envKey: string[];
  envModel: string[];
}> = [
  {
    id: "story-text",
    label: "故事文本模型",
    description: "故事生成 · text-generations（story）",
    envProvider: ["TEXT_LLM_PROVIDER", "STORY_TEXT_PROVIDER"],
    envUrl: ["DASHSCOPE_COMPATIBLE_BASE_URL", "STORY_TEXT_API_URL"],
    envKey: ["DASHSCOPE_API_KEY", "STORY_TEXT_API_KEY", "OPENAI_API_KEY"],
    envModel: ["TEXT_LLM_MODEL_ID", "DASHSCOPE_TEXT_MODEL_ID", "STORY_TEXT_MODEL"],
  },
  {
    id: "script-outline-text",
    label: "剧本大纲文本模型",
    description: "大纲生成 · text-generations（script_outline）",
    envProvider: ["TEXT_LLM_PROVIDER", "OUTLINE_TEXT_PROVIDER"],
    envUrl: ["DASHSCOPE_COMPATIBLE_BASE_URL", "OUTLINE_TEXT_API_URL"],
    envKey: [
      "DASHSCOPE_API_KEY",
      "OUTLINE_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "OUTLINE_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "script-episodes-text",
    label: "剧集文本模型",
    description: "根据大纲生成剧集 · text-generations（script_episodes）",
    envProvider: ["TEXT_LLM_PROVIDER", "EPISODES_TEXT_PROVIDER"],
    envUrl: ["DASHSCOPE_COMPATIBLE_BASE_URL", "EPISODES_TEXT_API_URL"],
    envKey: [
      "DASHSCOPE_API_KEY",
      "EPISODES_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "EPISODES_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "script-split-text",
    label: "智能分集文本模型（已停用·本地分集）",
    description: "已改为本地分集，不再需要模型配置",
    envProvider: ["TEXT_LLM_PROVIDER", "SCRIPT_SPLIT_TEXT_PROVIDER"],
    envUrl: ["DASHSCOPE_COMPATIBLE_BASE_URL", "SCRIPT_SPLIT_TEXT_API_URL"],
    envKey: [
      "DASHSCOPE_API_KEY",
      "SCRIPT_SPLIT_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "SCRIPT_SPLIT_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "episode-asset-design-text",
    label: "剧本资产提取文本模型（已废弃）",
    description: "旧版一次性提取 · 已由 asset-roster-extract-text / asset-detail-extract-text 取代",
    envProvider: ["TEXT_LLM_PROVIDER", "EPISODE_ASSET_DESIGN_TEXT_PROVIDER"],
    envUrl: [
      "DASHSCOPE_COMPATIBLE_BASE_URL",
      "EPISODE_ASSET_DESIGN_TEXT_API_URL",
    ],
    envKey: [
      "DASHSCOPE_API_KEY",
      "EPISODE_ASSET_DESIGN_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "EPISODE_ASSET_DESIGN_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "asset-roster-extract-text",
    label: "资产名单提取文本模型",
    description: "资产提取 · roster 阶段（asset.roster.extract）",
    envProvider: ["TEXT_LLM_PROVIDER", "ASSET_ROSTER_EXTRACT_TEXT_PROVIDER"],
    envUrl: [
      "DASHSCOPE_COMPATIBLE_BASE_URL",
      "ASSET_ROSTER_EXTRACT_TEXT_API_URL",
      "EPISODE_ASSET_DESIGN_TEXT_API_URL",
    ],
    envKey: [
      "DASHSCOPE_API_KEY",
      "ASSET_ROSTER_EXTRACT_TEXT_API_KEY",
      "EPISODE_ASSET_DESIGN_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "ASSET_ROSTER_EXTRACT_TEXT_MODEL",
      "EPISODE_ASSET_DESIGN_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "asset-detail-extract-text",
    label: "资产详情提取文本模型",
    description: "资产提取 · detail 阶段（asset.detail.extract）",
    envProvider: ["TEXT_LLM_PROVIDER", "ASSET_DETAIL_EXTRACT_TEXT_PROVIDER"],
    envUrl: [
      "DASHSCOPE_COMPATIBLE_BASE_URL",
      "ASSET_DETAIL_EXTRACT_TEXT_API_URL",
      "EPISODE_ASSET_DESIGN_TEXT_API_URL",
    ],
    envKey: [
      "DASHSCOPE_API_KEY",
      "ASSET_DETAIL_EXTRACT_TEXT_API_KEY",
      "EPISODE_ASSET_DESIGN_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "ASSET_DETAIL_EXTRACT_TEXT_MODEL",
      "EPISODE_ASSET_DESIGN_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "asset-design-prompt-text",
    label: "资产设计提示词文本模型",
    description: "资产设计提示词 · text-generations（asset_design_prompt）",
    envProvider: ["TEXT_LLM_PROVIDER", "ASSET_DESIGN_PROMPT_TEXT_PROVIDER"],
    envUrl: [
      "DASHSCOPE_COMPATIBLE_BASE_URL",
      "ASSET_DESIGN_PROMPT_TEXT_API_URL",
    ],
    envKey: [
      "DASHSCOPE_API_KEY",
      "ASSET_DESIGN_PROMPT_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "ASSET_DESIGN_PROMPT_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "storyboard-prompt-text",
    label: "分镜提示词文本模型",
    description: "分镜页 · 镜头视频提示词（storyboard_prompt）",
    envProvider: ["TEXT_LLM_PROVIDER", "STORYBOARD_PROMPT_TEXT_PROVIDER"],
    envUrl: [
      "DASHSCOPE_COMPATIBLE_BASE_URL",
      "STORYBOARD_PROMPT_TEXT_API_URL",
    ],
    envKey: [
      "DASHSCOPE_API_KEY",
      "STORYBOARD_PROMPT_TEXT_API_KEY",
      "STORY_TEXT_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: [
      "STORYBOARD_PROMPT_TEXT_MODEL",
      "TEXT_LLM_MODEL_ID",
      "DASHSCOPE_TEXT_MODEL_ID",
    ],
  },
  {
    id: "character-image",
    label: "角色外貌生成",
    description: "角色节点 · 外貌生图",
    envProvider: ["CHARACTER_IMAGE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["CHARACTER_IMAGE_API_URL"],
    envKey: ["CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
    envModel: ["CHARACTER_IMAGE_MODEL"],
  },
  {
    id: "character-voice",
    label: "角色声音生成",
    description: "角色节点 · 声音合成",
    envProvider: ["CHARACTER_VOICE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["CHARACTER_VOICE_API_URL"],
    envKey: ["CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
    envModel: ["CHARACTER_VOICE_MODEL"],
  },
  {
    id: "scene-image",
    label: "场景画面生成",
    description: "场景节点 · 场景生图",
    envProvider: ["SCENE_IMAGE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["SCENE_IMAGE_API_URL"],
    envKey: ["SCENE_GEN_API_KEY", "CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
    envModel: ["SCENE_IMAGE_MODEL"],
  },
  {
    id: "prop-image",
    label: "道具画面生成",
    description: "工作区资产管理 · 道具参考图",
    envProvider: ["PROP_IMAGE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["PROP_IMAGE_API_URL"],
    envKey: ["PROP_GEN_API_KEY", "CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
    envModel: ["PROP_IMAGE_MODEL"],
  },
  {
    id: "video-shot",
    label: "视频镜头生成",
    description:
      "镜头短片。移动 SD2（推荐真人参考）：填 http://主机:端口 或 …/v1/video/generations（文档创建接口）。方舟：https://ark.cn-beijing.volces.com/api/v3。也可设 VIDEO_SHOT_HTTP_DIALECT=sd2",
    envProvider: ["VIDEO_SHOT_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["VIDEO_SHOT_API_URL"],
    envKey: [
      "ARK_API_KEY",
      "VOLC_API_KEY",
      "VIDEO_GEN_API_KEY",
      "CHARACTER_GEN_API_KEY",
      "OPENAI_API_KEY",
    ],
    envModel: ["VIDEO_SHOT_MODEL", "ARK_VIDEO_MODEL"],
  },
  {
    id: "video-ref-precheck",
    label: "视频参考图预检",
    description:
      "方舟直连线路：用 VLM 检测疑似真人参考图，供分镜提交前跳过人物参考。可复用视频镜头 URL+Key。设计素材「人物校验」请改配「移动 SD2 平台」。",
    envProvider: ["VIDEO_REF_PRECHECK_PROVIDER", "VIDEO_SHOT_PROVIDER"],
    envUrl: ["VIDEO_REF_PRECHECK_API_URL", "VIDEO_SHOT_API_URL"],
    envKey: [
      "VIDEO_REF_PRECHECK_API_KEY",
      "ARK_API_KEY",
      "VOLC_API_KEY",
      "VIDEO_GEN_API_KEY",
    ],
    envModel: ["VIDEO_REF_PRECHECK_MODEL"],
  },
  {
    id: "sd2-platform",
    label: "移动 SD2 平台",
    description:
      "设计素材「人物校验」与 SD2 真人认证上传。视频镜头可继续用方舟；此处单独填 SD2 平台根地址 + Key（或 …/v1/video/generations）。",
    envProvider: ["SD2_PLATFORM_PROVIDER", "VIDEO_SHOT_PROVIDER"],
    envUrl: ["SD2_PLATFORM_API_URL", "VIDEO_SHOT_API_URL"],
    envKey: [
      "SD2_PLATFORM_API_KEY",
      "VIDEO_GEN_API_KEY",
      "ARK_API_KEY",
      "VOLC_API_KEY",
    ],
    envModel: ["SD2_PLATFORM_MODEL", "VIDEO_SHOT_MODEL"],
  },
];

const ALL_PROFILE_IDS = new Set(GENERATION_API_DEFS.map((d) => d.id));

export function isGenerationApiId(id: string): id is GenerationApiId {
  return ALL_PROFILE_IDS.has(id as GenerationApiId);
}

function firstEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function defaultDashScopeCompatibleBase(): string {
  const region = (process.env.DASHSCOPE_REGION ?? "cn-beijing").trim();
  if (region === "ap-southeast-1" || region === "singapore") {
    return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  }
  return "https://dashscope.aliyuncs.com/compatible-mode/v1";
}

function defaultFromEnv(
  def: (typeof GENERATION_API_DEFS)[number],
): GenerationApiConfig {
  const providerRaw = firstEnv(def.envProvider).toLowerCase();
  // Text slots: dashscope env maps to http-compatible runtime via resolver.
  let provider: GenerationApiProvider = "mock";
  if (providerRaw === "http" || providerRaw === "dashscope") {
    provider = "http";
  }
  let apiUrl = firstEnv(def.envUrl);
  if (
    provider === "http" &&
    !apiUrl &&
    (def.id === "story-text" ||
      def.id === "script-outline-text" ||
      def.id === "script-episodes-text" ||
      def.id === "script-split-text" ||
      def.id === "episode-asset-design-text" ||
      def.id === "asset-roster-extract-text" ||
      def.id === "asset-detail-extract-text" ||
      def.id === "asset-design-prompt-text" ||
      def.id === "storyboard-prompt-text")
  ) {
    apiUrl = defaultDashScopeCompatibleBase();
  }
  let model = firstEnv(def.envModel);
  if (
    !model &&
    (def.id === "story-text" ||
      def.id === "script-outline-text" ||
      def.id === "script-episodes-text" ||
      def.id === "script-split-text" ||
      def.id === "episode-asset-design-text" ||
      def.id === "asset-roster-extract-text" ||
      def.id === "asset-detail-extract-text" ||
      def.id === "asset-design-prompt-text" ||
      def.id === "storyboard-prompt-text")
  ) {
    model = "qwen-plus";
  }
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    provider,
    apiUrl,
    apiKey: firstEnv(def.envKey),
    model,
    enabled: true,
    updatedAt: new Date(0).toISOString(),
  };
}

function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `********${key.slice(-4)}`;
}

export function isPlausibleApiKey(apiKey: string): boolean {
  const key = apiKey.trim();
  if (!key) return false;
  if (/^https?:\/\//i.test(key)) return false;
  if (key.includes("://")) return false;
  if (key === "管理员" || key.length < 8) return false;
  return true;
}

export function normalizeGenerationApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/cn-bejing\./gi, "cn-beijing.");
}

export function looksLikeArkVideoEndpoint(apiUrl: string): boolean {
  const url = normalizeGenerationApiUrl(apiUrl).toLowerCase();
  return (
    url.includes("ark.cn-beijing.volces.com") ||
    url.includes("ark.cn-bejing.volces.com") ||
    url.includes("/contents/generations/tasks") ||
    (/volces\.com/.test(url) && /\/api\/v3/.test(url))
  );
}

export function isInvalidGenerationApiUrl(apiUrl: string): boolean {
  const url = normalizeGenerationApiUrl(apiUrl).toLowerCase();
  if (!url) return false;
  if (url.includes("console.volcengine.com")) return true;
  if (url.includes("/auth/login")) return true;
  if (url === "管理员") return true;
  return false;
}

export function toPublicConfig(
  config: GenerationApiConfig,
): GenerationApiConfigPublic {
  return {
    id: config.id,
    label: config.label,
    description: config.description,
    provider: config.provider,
    apiUrl: config.apiUrl,
    model: config.model,
    enabled: config.enabled !== false,
    updatedAt: config.updatedAt,
    hasApiKey: isPlausibleApiKey(config.apiKey),
    apiKeyMasked: isPlausibleApiKey(config.apiKey)
      ? maskApiKey(config.apiKey)
      : "",
    modality: profileSlotModality(config.id),
    legacyPlaintextSecret: config.legacyPlaintextSecret === true,
  };
}

async function ensureDir() {
  await fs.mkdir(resolveAppDataPath(), { recursive: true });
}

async function readFile(): Promise<ApiConfigFile> {
  if (isRemoteDataOnly()) {
    const response = await requestRemoteData("/v1/generation-api-configs");
    if (!response.ok) {
      throw new Error(`REMOTE_API_CONFIG_READ_FAILED:${response.status}`);
    }
    return normalizeApiConfigFile(await response.json());
  }
  await ensureDir();
  try {
    const raw = await fs.readFile(configFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as ApiConfigFile;
    if (!parsed || !Array.isArray(parsed.configs)) {
      return { version: 2, configs: [], bindings: [], audit: [] };
    }
    return normalizeApiConfigFile(parsed);
  } catch {
    return { version: 2, configs: [], bindings: [], audit: [] };
  }
}

async function writeFile(data: ApiConfigFile) {
  const sealed = sealApiConfigFile(data);
  if (isRemoteDataOnly()) {
    const response = await requestRemoteData("/v1/generation-api-configs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sealed),
    });
    if (!response.ok) {
      throw new Error(`REMOTE_API_CONFIG_WRITE_FAILED:${response.status}`);
    }
    return;
  }
  await ensureDir();
  const file = configFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(sealed, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function normalizeApiConfigFile(value: unknown): ApiConfigFile {
  if (!value || typeof value !== "object") {
    return { version: 2, configs: [], bindings: [], audit: [] };
  }
  const parsed = value as Partial<ApiConfigFile>;
  return {
    version: 2,
    configs: Array.isArray(parsed.configs) ? parsed.configs : [],
    bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
  };
}

function sealApiConfigFile(data: ApiConfigFile): ApiConfigFile {
  const sealedConfigs = data.configs.map((c) => {
    let sealedKey = "";
    if ((c.apiKey ?? "").trim()) {
      if (isEncryptedSecret(c.apiKey)) {
        sealedKey = c.apiKey;
      } else if (
        c.legacyPlaintextSecret &&
        !(process.env.AI_CONFIG_ENCRYPTION_KEY ?? "").trim()
      ) {
        sealedKey = c.apiKey;
      } else {
        sealedKey = sealApiKeyForStorage(c.apiKey);
      }
    }
    return {
      id: c.id,
      label: c.label,
      description: c.description,
      provider: c.provider,
      apiUrl: c.apiUrl,
      apiKey: sealedKey,
      model: c.model,
      enabled: c.enabled !== false,
      updatedAt: c.updatedAt,
    };
  });
  return {
    version: 2,
    configs: sealedConfigs,
    bindings: data.bindings ?? [],
    audit: data.audit ?? [],
  };
}

function mergeWithDefaults(stored: GenerationApiConfig[]): GenerationApiConfig[] {
  const map = new Map(stored.map((c) => [c.id, c]));
  return GENERATION_API_DEFS.map((def) => {
    const fallback = defaultFromEnv(def);
    const hit = map.get(def.id);
    if (!hit) return fallback;
    const materialized = materializeStoredKey(hit.apiKey ?? "");
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      provider: normalizeProvider(hit.provider, def.id),
      apiUrl: hit.apiUrl ?? "",
      apiKey: materialized.apiKey,
      model: hit.model ?? fallback.model ?? "",
      enabled: hit.enabled !== false,
      legacyPlaintextSecret: materialized.legacyPlaintextSecret,
      secretUnavailable: materialized.secretUnavailable,
      updatedAt: hit.updatedAt || fallback.updatedAt,
    };
  });
}

function defaultBindings(): AiCapabilityBinding[] {
  const now = new Date(0).toISOString();
  return AI_CAPABILITIES.map((cap) => ({
    capabilityId: cap.id,
    profileSlotId: cap.defaultProfileSlot,
    enabled: cap.status === "active",
    updatedAt: now,
    updatedBy: "system",
  }));
}

function mergeBindings(
  stored: AiCapabilityBinding[] | undefined,
): AiCapabilityBinding[] {
  const map = new Map((stored ?? []).map((b) => [b.capabilityId, b]));
  return defaultBindings().map((fallback) => {
    const hit = map.get(fallback.capabilityId);
    if (!hit) return fallback;
    const cap = getAiCapability(fallback.capabilityId);
    // Explicit null means unbound — never silently restore the default slot.
    let slot = fallback.profileSlotId;
    if (hit.profileSlotId === null) {
      slot = null;
    } else if (
      typeof hit.profileSlotId === "string" &&
      isGenerationApiId(hit.profileSlotId)
    ) {
      slot = hit.profileSlotId;
    }
    return {
      capabilityId: fallback.capabilityId,
      profileSlotId: slot,
      enabled: cap?.status === "planned" ? false : hit.enabled !== false,
      updatedAt: hit.updatedAt || fallback.updatedAt,
      updatedBy: hit.updatedBy || fallback.updatedBy,
    };
  });
}

export async function listGenerationApiConfigs(): Promise<GenerationApiConfig[]> {
  const file = await readFile();
  return mergeWithDefaults(file.configs);
}

export async function getGenerationApiConfig(
  id: GenerationApiId,
): Promise<GenerationApiConfig> {
  const all = await listGenerationApiConfigs();
  const hit = all.find((c) => c.id === id);
  if (!hit) {
    throw new Error(`未知生成能力：${id}`);
  }
  return hit;
}

export async function listCapabilityBindings(): Promise<AiCapabilityBinding[]> {
  const file = await readFile();
  return mergeBindings(file.bindings);
}

export async function getCapabilityBinding(
  capabilityId: AiCapabilityId,
): Promise<AiCapabilityBinding> {
  const all = await listCapabilityBindings();
  const hit = all.find((b) => b.capabilityId === capabilityId);
  if (!hit) {
    throw new Error(`未知 capability：${capabilityId}`);
  }
  return hit;
}

export type GenerationApiPatch = {
  provider?: GenerationApiProvider;
  apiUrl?: string;
  apiKey?: string | null;
  model?: string;
  enabled?: boolean;
};

export async function updateGenerationApiConfig(
  id: GenerationApiId,
  patch: GenerationApiPatch,
  updatedBy = "admin",
): Promise<GenerationApiConfig> {
  const file = await readFile();
  const rawStored = file.configs.find((c) => c.id === id);
  const all = mergeWithDefaults(file.configs);
  const index = all.findIndex((c) => c.id === id);
  if (index < 0) {
    throw new Error(`未知生成能力：${id}`);
  }
  const current = all[index]!;
  const nextApiUrl =
    typeof patch.apiUrl === "string"
      ? normalizeGenerationApiUrl(patch.apiUrl)
      : normalizeGenerationApiUrl(current.apiUrl);
  const nextApiKey =
    patch.apiKey === null
      ? ""
      : typeof patch.apiKey === "string" && patch.apiKey.trim()
        ? patch.apiKey.trim()
        : current.apiKey;
  const nextModel =
    typeof patch.model === "string" ? patch.model.trim() : current.model ?? "";
  const nextProvider = normalizeProvider(
    patch.provider ?? current.provider,
    id,
  );
  const nextEnabled =
    typeof patch.enabled === "boolean" ? patch.enabled : current.enabled !== false;

  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    if (!isPlausibleApiKey(patch.apiKey)) {
      throw new Error(
        "API Key 不能是网址。请把接口地址填到「API 地址」，密钥填到「API Key」",
      );
    }
    if (!(process.env.AI_CONFIG_ENCRYPTION_KEY ?? "").trim()) {
      throw new AiSecretCryptoError(
        "AI_CONFIG_ENCRYPTION_KEY_MISSING",
        "未配置 AI_CONFIG_ENCRYPTION_KEY，无法保存新的 API 凭据",
      );
    }
  }

  const cleanedKey =
    nextApiKey && !isPlausibleApiKey(nextApiKey) ? "" : nextApiKey;

  if (nextProvider === "http" && nextApiUrl) {
    assertSafeAiEndpointUrl(
      nextApiUrl,
      urlGuardOptionsForProfileSlot(id),
    );
  }

  if (nextProvider === "aliyun-wan27" && id !== "video-shot") {
    throw new Error("仅视频镜头配置可使用阿里云付费 Provider");
  }

  if (nextProvider === "http" && id === "video-shot") {
    if (!nextApiUrl) {
      throw new Error("请填写视频镜头 API 地址");
    }
    if (isInvalidGenerationApiUrl(nextApiUrl)) {
      throw new Error(
        "API 地址不能是控制台/登录页。请填写 https://ark.cn-beijing.volces.com/api/v3",
      );
    }
    if (looksLikeArkVideoEndpoint(nextApiUrl) && !cleanedKey) {
      throw new Error(
        "方舟视频需填写有效 API Key（地址填 Base URL，密钥单独填 API Key；留空可保留原 Key）",
      );
    }
  }

  if (
    nextProvider === "http" &&
    (id === "story-text" ||
      id === "script-outline-text" ||
      id === "script-episodes-text" ||
      id === "script-split-text" ||
      id === "episode-asset-design-text" ||
      id === "asset-design-prompt-text" ||
      id === "storyboard-prompt-text") &&
    !cleanedKey
  ) {
    throw new Error("HTTP 文本模型需要有效 API Key（留空可保留原 Key）");
  }

  const next: GenerationApiConfig = {
    ...current,
    provider: nextProvider,
    apiUrl: nextApiUrl,
    apiKey: (() => {
      if (patch.apiKey === null) return "";
      if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
        return cleanedKey;
      }
      if (current.secretUnavailable && rawStored?.apiKey) {
        return rawStored.apiKey;
      }
      return cleanedKey;
    })(),
    model: nextModel,
    enabled: nextEnabled,
    legacyPlaintextSecret:
      patch.apiKey === null ||
      (typeof patch.apiKey === "string" && !!patch.apiKey.trim())
        ? false
        : current.legacyPlaintextSecret === true &&
          !(process.env.AI_CONFIG_ENCRYPTION_KEY ?? "").trim(),
    secretUnavailable: false,
    updatedAt: new Date().toISOString(),
  };
  all[index] = next;

  const changedFields: string[] = [];
  if (patch.provider !== undefined) changedFields.push("provider");
  if (patch.apiUrl !== undefined) changedFields.push("apiUrl");
  if (patch.model !== undefined) changedFields.push("model");
  if (patch.enabled !== undefined) changedFields.push("enabled");
  if (patch.apiKey === null) changedFields.push("apiKeyCleared");
  else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    changedFields.push("apiKeyUpdated");
  }

  const audit = [
    ...(file.audit ?? []),
    {
      id: `aud_${Date.now()}`,
      action: "update_profile",
      profileSlotId: id,
      changedFields,
      updatedBy,
      updatedAt: next.updatedAt,
    },
  ].slice(-200);

  await writeFile({
    version: 2,
    configs: all,
    bindings: mergeBindings(file.bindings),
    audit,
  });
  return next;
}

export async function updateCapabilityBinding(
  capabilityId: AiCapabilityId,
  patch: {
    profileSlotId?: AiModelProfileSlotId | null;
    enabled?: boolean;
  },
  updatedBy: string,
): Promise<AiCapabilityBinding> {
  const cap = getAiCapability(capabilityId);
  if (!cap) {
    throw new Error(`未知 capability：${capabilityId}`);
  }
  if (cap.status === "planned" && patch.enabled === true) {
    throw new Error("功能尚未接线，不能启用运行");
  }

  const file = await readFile();
  const bindings = mergeBindings(file.bindings);
  const index = bindings.findIndex((b) => b.capabilityId === capabilityId);
  if (index < 0) throw new Error(`未知 capability：${capabilityId}`);
  const current = bindings[index]!;

  let nextSlot =
    patch.profileSlotId === undefined
      ? current.profileSlotId
      : patch.profileSlotId;

  if (nextSlot !== null && nextSlot !== undefined) {
    if (!isGenerationApiId(nextSlot)) {
      throw new Error("无效的模型配置槽位");
    }
    if (profileSlotModality(nextSlot) !== cap.modality) {
      throw new Error("模型模态与功能不匹配");
    }
  }

  if (cap.status === "planned") {
    nextSlot = null;
  }

  const next: AiCapabilityBinding = {
    capabilityId,
    profileSlotId: nextSlot,
    enabled:
      typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  if (cap.status === "planned") {
    next.enabled = false;
  }

  bindings[index] = next;
  const changedFields: string[] = [];
  if (patch.profileSlotId !== undefined) changedFields.push("profileSlotId");
  if (patch.enabled !== undefined) changedFields.push("enabled");

  const audit = [
    ...(file.audit ?? []),
    {
      id: `aud_${Date.now()}`,
      action: "update_binding",
      capabilityId,
      profileSlotId: next.profileSlotId ?? undefined,
      changedFields,
      updatedBy,
      updatedAt: next.updatedAt,
    },
  ].slice(-200);

  await writeFile({
    version: 2,
    configs: mergeWithDefaults(file.configs),
    bindings,
    audit,
  });
  return next;
}

export async function listConfigAuditEntries(limit = 50) {
  const file = await readFile();
  return (file.audit ?? []).slice(-limit).reverse();
}
