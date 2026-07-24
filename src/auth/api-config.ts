import { promises as fs } from "fs";
import path from "path";

export type GenerationApiId =
  | "character-image"
  | "character-voice"
  | "scene-image"
  | "video-shot";

export type GenerationApiProvider = "mock" | "http";

export type GenerationApiConfig = {
  id: GenerationApiId;
  label: string;
  description: string;
  provider: GenerationApiProvider;
  apiUrl: string;
  apiKey: string;
  updatedAt: string;
};

export type GenerationApiConfigPublic = Omit<GenerationApiConfig, "apiKey"> & {
  /** 是否已配置密钥（不回传明文） */
  hasApiKey: boolean;
  /** 脱敏展示，如 sk••••1234 */
  apiKeyMasked: string;
};

type ApiConfigFile = {
  version: 1;
  configs: GenerationApiConfig[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "generation-api-configs.json");

export const GENERATION_API_DEFS: Array<{
  id: GenerationApiId;
  label: string;
  description: string;
  envProvider: string[];
  envUrl: string[];
  envKey: string[];
}> = [
  {
    id: "character-image",
    label: "角色外貌生成",
    description: "角色节点 · 外貌生图",
    envProvider: ["CHARACTER_IMAGE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["CHARACTER_IMAGE_API_URL"],
    envKey: ["CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "character-voice",
    label: "角色声音生成",
    description: "角色节点 · 声音合成",
    envProvider: ["CHARACTER_VOICE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["CHARACTER_VOICE_API_URL"],
    envKey: ["CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "scene-image",
    label: "场景画面生成",
    description: "场景节点 · 场景生图",
    envProvider: ["SCENE_IMAGE_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["SCENE_IMAGE_API_URL"],
    envKey: ["SCENE_GEN_API_KEY", "CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "video-shot",
    label: "视频镜头生成",
    description: "视频节点 · 短片生成",
    envProvider: ["VIDEO_SHOT_PROVIDER", "CHARACTER_GEN_PROVIDER"],
    envUrl: ["VIDEO_SHOT_API_URL"],
    envKey: ["VIDEO_GEN_API_KEY", "CHARACTER_GEN_API_KEY", "OPENAI_API_KEY"],
  },
];

function firstEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function defaultFromEnv(
  def: (typeof GENERATION_API_DEFS)[number],
): GenerationApiConfig {
  const providerRaw = firstEnv(def.envProvider).toLowerCase();
  const provider: GenerationApiProvider =
    providerRaw === "http" ? "http" : "mock";
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    provider,
    apiUrl: firstEnv(def.envUrl),
    apiKey: firstEnv(def.envKey),
    updatedAt: new Date(0).toISOString(),
  };
}

function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
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
    updatedAt: config.updatedAt,
    hasApiKey: Boolean(config.apiKey.trim()),
    apiKeyMasked: maskApiKey(config.apiKey),
  };
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<ApiConfigFile> {
  await ensureDir();
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ApiConfigFile;
    if (!parsed || !Array.isArray(parsed.configs)) {
      return { version: 1, configs: [] };
    }
    return { version: 1, configs: parsed.configs };
  } catch {
    return { version: 1, configs: [] };
  }
}

async function writeFile(data: ApiConfigFile) {
  await ensureDir();
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, CONFIG_FILE);
}

function mergeWithDefaults(stored: GenerationApiConfig[]): GenerationApiConfig[] {
  const map = new Map(stored.map((c) => [c.id, c]));
  return GENERATION_API_DEFS.map((def) => {
    const fallback = defaultFromEnv(def);
    const hit = map.get(def.id);
    if (!hit) return fallback;
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      provider: hit.provider === "http" ? "http" : "mock",
      apiUrl: hit.apiUrl ?? "",
      apiKey: hit.apiKey ?? "",
      updatedAt: hit.updatedAt || fallback.updatedAt,
    };
  });
}

/** 读取全部生成 API 配置（含密钥，仅服务端使用） */
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

export type GenerationApiPatch = {
  provider?: GenerationApiProvider;
  apiUrl?: string;
  /** 传空字符串表示清除；不传或省略表示保持原密钥 */
  apiKey?: string | null;
};

export async function updateGenerationApiConfig(
  id: GenerationApiId,
  patch: GenerationApiPatch,
): Promise<GenerationApiConfig> {
  const all = await listGenerationApiConfigs();
  const index = all.findIndex((c) => c.id === id);
  if (index < 0) {
    throw new Error(`未知生成能力：${id}`);
  }
  const current = all[index]!;
  const next: GenerationApiConfig = {
    ...current,
    provider:
      patch.provider === "http" || patch.provider === "mock"
        ? patch.provider
        : current.provider,
    apiUrl:
      typeof patch.apiUrl === "string" ? patch.apiUrl.trim() : current.apiUrl,
    apiKey:
      patch.apiKey === null
        ? ""
        : typeof patch.apiKey === "string" && patch.apiKey.trim()
          ? patch.apiKey.trim()
          : current.apiKey,
    updatedAt: new Date().toISOString(),
  };
  all[index] = next;
  await writeFile({ version: 1, configs: all });
  return next;
}
