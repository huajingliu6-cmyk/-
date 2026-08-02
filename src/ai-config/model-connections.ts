import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import {
  GENERATION_API_DEFS,
  getGenerationApiConfig,
  isGenerationApiId,
  isPlausibleApiKey,
  listGenerationApiConfigs,
  updateGenerationApiConfig,
  type GenerationApiId,
  type GenerationApiProvider,
} from "@/auth/api-config";
import {
  profileSlotModality,
  type AiModality,
  type AiModelProfileSlotId,
} from "@/ai-config/capabilities";
import { AiConfigError } from "@/ai-config/errors";
import {
  isEncryptedSecret,
  resolveStoredApiKey,
  sealApiKeyForStorage,
  AiSecretCryptoError,
} from "@/ai-config/secret-crypto";
import { assertSafeAiEndpointUrl, urlGuardOptionsForProfileSlot } from "@/ai-config/url-guard";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  isRemoteDataOnly,
  requestRemoteData,
} from "@/persistence/remote-data-client";

export type ModelProviderMode = "mock" | "http" | "aliyun-wan27";

export type ModelConnectionLastTestStatus =
  | "untested"
  | "testing"
  | "success"
  | "failed";

export type ModelConnection = {
  id: string;
  displayName: string;
  modality: AiModality;
  providerMode: ModelProviderMode;
  baseUrl: string | null;
  endpointPath: string | null;
  modelId: string | null;
  endpointId: string | null;
  enabled: boolean;
  /** Encrypted on disk; plaintext in memory after load. */
  apiKey: string;
  timeoutMs: number | null;
  createdAt: string;
  updatedAt: string;
  lastTestStatus: ModelConnectionLastTestStatus;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  /** Virtual legacy connections are read-only synthesis. */
  legacyVirtual?: boolean;
};

export type ModelConnectionPublic = Omit<ModelConnection, "apiKey"> & {
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
};

export type AiModelBinding = {
  profileSlot: AiModelProfileSlotId;
  modelConnectionId: string | null;
  updatedBy: string;
  updatedAt: string;
};

type ModelConnectionsFile = {
  schemaVersion: 1;
  connections: Array<Omit<ModelConnection, "legacyVirtual"> & { apiKey: string }>;
  slotBindings: Partial<Record<AiModelProfileSlotId, string | null>>;
};

const REMOTE_BASE = Symbol("remoteModelConnectionsBase");

type ModelConnectionsFileWithBase = ModelConnectionsFile & {
  [REMOTE_BASE]?: ModelConnectionsFile;
};

const SUPPORTED_PROVIDERS: ReadonlySet<ModelProviderMode> = new Set([
  "mock",
  "http",
  "aliyun-wan27",
]);

function connectionsFilePath(): string {
  return resolveAppDataPath("ai-model-connections.json");
}

function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `********${key.slice(-4)}`;
}

function toPublic(conn: ModelConnection): ModelConnectionPublic {
  const { apiKey, ...rest } = conn;
  return {
    ...rest,
    legacyVirtual: !!conn.legacyVirtual || isLegacyVirtualId(conn.id),
    apiKeyConfigured: isPlausibleApiKey(apiKey),
    apiKeyMasked: isPlausibleApiKey(apiKey) ? maskApiKey(apiKey) : "",
  };
}

function materializeApiKey(stored: string): string {
  if (!stored) return "";
  if (isEncryptedSecret(stored)) {
    try {
      return resolveStoredApiKey(stored).plaintext;
    } catch {
      return "";
    }
  }
  return stored;
}

function legacyConnectionId(slotId: GenerationApiId): string {
  return `legacy-slot-${slotId}`;
}

function isLegacyVirtualId(id: string): boolean {
  return id.startsWith("legacy-slot-");
}

async function readFileOrNull(): Promise<ModelConnectionsFile | null> {
  if (isRemoteDataOnly()) {
    const response = await requestRemoteData("/v1/model-connections");
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`REMOTE_MODEL_CONNECTION_READ_FAILED:${response.status}`);
    }
    const normalized = normalizeConnectionsFile(await response.json());
    if (!normalized) return null;
    return attachRemoteBase(normalized, normalized);
  }
  try {
    const raw = await fs.readFile(connectionsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as ModelConnectionsFile;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.connections)) {
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function synthesizeLegacyConnections(
  configs: Awaited<ReturnType<typeof listGenerationApiConfigs>>,
): ModelConnection[] {
  return configs.map((cfg) => ({
    id: legacyConnectionId(cfg.id),
    displayName: cfg.label,
    modality: profileSlotModality(cfg.id),
    providerMode: cfg.provider as ModelProviderMode,
    baseUrl: cfg.apiUrl || null,
    endpointPath: null,
    modelId: cfg.model || null,
    endpointId: null,
    enabled: cfg.enabled !== false,
    apiKey: cfg.apiKey,
    timeoutMs: null,
    createdAt: cfg.updatedAt,
    updatedAt: cfg.updatedAt,
    lastTestStatus: "untested" as const,
    lastTestedAt: null,
    lastTestMessage: null,
    legacyVirtual: true,
  }));
}

async function loadConnectionsInternal(): Promise<{
  file: ModelConnectionsFile | null;
  connections: ModelConnection[];
}> {
  const legacy = synthesizeLegacyConnections(await listGenerationApiConfigs());
  const file = await readFileOrNull();
  if (!file) {
    return { file: null, connections: legacy };
  }
  const real: ModelConnection[] = file.connections.map((c) => ({
    ...c,
    apiKey: materializeApiKey(c.apiKey ?? ""),
    legacyVirtual: false,
  }));
  const realIds = new Set(real.map((c) => c.id));
  return {
    file,
    connections: [...real, ...legacy.filter((l) => !realIds.has(l.id))],
  };
}

async function writeFile(data: ModelConnectionsFile): Promise<void> {
  const sealed = sealConnectionsFile(data);
  if (isRemoteDataOnly()) {
    const base = (data as ModelConnectionsFileWithBase)[REMOTE_BASE] ?? {
      schemaVersion: 1 as const,
      connections: [],
      slotBindings: {},
    };
    const response = await requestRemoteData("/v1/model-connections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base, desired: sealed }),
    });
    if (!response.ok) {
      throw new Error(`REMOTE_MODEL_CONNECTION_WRITE_FAILED:${response.status}`);
    }
    return;
  }
  await fs.mkdir(resolveAppDataPath(), { recursive: true });
  const file = connectionsFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(sealed, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function sealConnectionsFile(data: ModelConnectionsFile): ModelConnectionsFile {
  const sealed = data.connections.map((c) => {
    let sealedKey = "";
    if ((c.apiKey ?? "").trim()) {
      sealedKey = isEncryptedSecret(c.apiKey)
        ? c.apiKey
        : sealApiKeyForStorage(c.apiKey);
    }
    const { legacyVirtual, ...rest } = c as ModelConnection;
    void legacyVirtual;
    return { ...rest, apiKey: sealedKey };
  });
  return { schemaVersion: 1, connections: sealed, slotBindings: data.slotBindings };
}

function normalizeConnectionsFile(value: unknown): ModelConnectionsFile | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<ModelConnectionsFile>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.connections)) {
    return null;
  }
  return {
    schemaVersion: 1,
    connections: parsed.connections,
    slotBindings:
      parsed.slotBindings && typeof parsed.slotBindings === "object"
        ? parsed.slotBindings
        : {},
  };
}

function attachRemoteBase(
  file: ModelConnectionsFile,
  base: ModelConnectionsFile,
): ModelConnectionsFile {
  Object.defineProperty(file, REMOTE_BASE, {
    value: structuredClone(base),
    enumerable: false,
  });
  return file;
}

function newConnectionId(): string {
  return `mc_${randomBytes(8).toString("hex")}`;
}

function assertSupportedProvider(mode: string): ModelProviderMode {
  if (!SUPPORTED_PROVIDERS.has(mode as ModelProviderMode)) {
    throw new AiConfigError(
      "AI_MODEL_ADAPTER_UNAVAILABLE",
      `不支持的 Provider 模式：${mode}`,
    );
  }
  return mode as ModelProviderMode;
}

export async function listConnectionsPublic(): Promise<ModelConnectionPublic[]> {
  const { connections } = await loadConnectionsInternal();
  return connections
    .filter(
      (c) =>
        c.id !== "legacy-slot-script-split-text" &&
        c.id !== "legacy-slot-asset-design-prompt-text",
    )
    .map(toPublic);
}

export async function getConnection(id: string): Promise<ModelConnection | null> {
  const { connections } = await loadConnectionsInternal();
  return connections.find((c) => c.id === id) ?? null;
}

export async function getConnectionOrThrow(id: string): Promise<ModelConnection> {
  const conn = await getConnection(id);
  if (!conn) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "模型连接不存在");
  }
  return conn;
}

export type CreateConnectionInput = {
  displayName: string;
  modality: AiModality;
  providerMode: ModelProviderMode;
  baseUrl?: string | null;
  endpointPath?: string | null;
  modelId?: string | null;
  endpointId?: string | null;
  enabled?: boolean;
  apiKey?: string;
  timeoutMs?: number | null;
};

export async function createConnection(
  input: CreateConnectionInput,
  userId: string,
): Promise<ModelConnectionPublic> {
  assertSupportedProvider(input.providerMode);
  const now = new Date().toISOString();
  const file = (await readFileOrNull()) ?? {
    schemaVersion: 1 as const,
    connections: [],
    slotBindings: {},
  };
  const conn: ModelConnection = {
    id: newConnectionId(),
    displayName: input.displayName.trim(),
    modality: input.modality,
    providerMode: input.providerMode,
    baseUrl: input.baseUrl?.trim() || null,
    endpointPath: input.endpointPath?.trim() || null,
    modelId: input.modelId?.trim() || null,
    endpointId: input.endpointId?.trim() || null,
    enabled: input.enabled !== false,
    apiKey: input.apiKey?.trim() ?? "",
    timeoutMs: input.timeoutMs ?? null,
    createdAt: now,
    updatedAt: now,
    lastTestStatus: "untested",
    lastTestedAt: null,
    lastTestMessage: null,
    legacyVirtual: false,
  };
  if (conn.providerMode === "http" && conn.baseUrl) {
    assertSafeAiEndpointUrl(conn.baseUrl, {
      allowPrivateEndpoints: process.env.ALLOW_PRIVATE_AI_ENDPOINTS === "true",
    });
  }
  file.connections.push({
    ...conn,
    apiKey: conn.apiKey,
  });
  await writeFile(file);
  void userId;
  return toPublic(conn);
}

export type UpdateConnectionInput = Partial<
  Omit<CreateConnectionInput, "modality">
> & {
  clearApiKey?: boolean;
};

export async function updateConnection(
  id: string,
  patch: UpdateConnectionInput,
  userId: string,
): Promise<ModelConnectionPublic> {
  if (isLegacyVirtualId(id)) {
    return updateLegacyVirtualConnection(id, patch, userId);
  }
  const file = await readFileOrNull();
  if (!file) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "模型连接不存在");
  }
  const index = file.connections.findIndex((c) => c.id === id);
  if (index < 0) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "模型连接不存在");
  }
  const current = file.connections[index]!;
  const nextProvider = patch.providerMode
    ? assertSupportedProvider(patch.providerMode)
    : (current.providerMode as ModelProviderMode);
  let nextKey = materializeApiKey(current.apiKey);
  if (patch.clearApiKey) {
    nextKey = "";
  } else if (patch.apiKey?.trim()) {
    if (!isPlausibleApiKey(patch.apiKey)) {
      throw new Error("API Key 格式无效");
    }
    try {
      nextKey = patch.apiKey.trim();
    } catch (err) {
      if (err instanceof AiSecretCryptoError) throw err;
      throw err;
    }
  }
  const next: ModelConnection = {
    id: current.id,
    displayName: patch.displayName?.trim() ?? current.displayName,
    modality: current.modality as AiModality,
    providerMode: nextProvider,
    baseUrl:
      patch.baseUrl !== undefined
        ? patch.baseUrl?.trim() || null
        : current.baseUrl,
    endpointPath:
      patch.endpointPath !== undefined
        ? patch.endpointPath?.trim() || null
        : current.endpointPath,
    modelId:
      patch.modelId !== undefined
        ? patch.modelId?.trim() || null
        : current.modelId,
    endpointId:
      patch.endpointId !== undefined
        ? patch.endpointId?.trim() || null
        : current.endpointId,
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    apiKey: nextKey,
    timeoutMs:
      patch.timeoutMs !== undefined ? patch.timeoutMs : current.timeoutMs,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    lastTestStatus: current.lastTestStatus as ModelConnectionLastTestStatus,
    lastTestedAt: current.lastTestedAt,
    lastTestMessage: current.lastTestMessage,
  };
  if (next.providerMode === "http" && next.baseUrl) {
    assertSafeAiEndpointUrl(next.baseUrl, {
      allowPrivateEndpoints: process.env.ALLOW_PRIVATE_AI_ENDPOINTS === "true",
    });
  }
  file.connections[index] = { ...next, apiKey: next.apiKey };
  await writeFile(file);
  void userId;
  return toPublic(next);
}

/**
 * Persist edits on a virtual legacy-slot-* row by writing through to the
 * underlying generation-api profile slot, then clear any explicit slot binding
 * so runtime resolves the updated profile.
 */
async function updateLegacyVirtualConnection(
  id: string,
  patch: UpdateConnectionInput,
  userId: string,
): Promise<ModelConnectionPublic> {
  const slotRaw = id.slice("legacy-slot-".length);
  if (!isGenerationApiId(slotRaw)) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "无效的 legacy 连接");
  }
  const current = await getConnection(id);
  if (!current) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "模型连接不存在");
  }
  const nextProvider = patch.providerMode
    ? assertSupportedProvider(patch.providerMode)
    : current.providerMode;
  const nextBaseUrl =
    patch.baseUrl !== undefined
      ? patch.baseUrl?.trim() || ""
      : current.baseUrl ?? "";
  const nextModel =
    patch.modelId !== undefined
      ? patch.modelId?.trim() || ""
      : current.modelId ?? "";
  const nextEnabled =
    patch.enabled !== undefined ? patch.enabled : current.enabled;

  let apiKeyPatch: string | null | undefined;
  if (patch.clearApiKey) {
    apiKeyPatch = null;
  } else if (patch.apiKey?.trim()) {
    if (!isPlausibleApiKey(patch.apiKey)) {
      throw new Error("API Key 格式无效");
    }
    apiKeyPatch = patch.apiKey.trim();
  }

  if (nextProvider === "http" && nextBaseUrl) {
    assertSafeAiEndpointUrl(
      nextBaseUrl,
      urlGuardOptionsForProfileSlot(slotRaw),
    );
  }

  try {
    await updateGenerationApiConfig(
      slotRaw,
      {
        provider: nextProvider as GenerationApiProvider,
        apiUrl: nextBaseUrl,
        model: nextModel,
        enabled: nextEnabled,
        ...(apiKeyPatch !== undefined ? { apiKey: apiKeyPatch } : {}),
      },
      userId,
    );
  } catch (err) {
    if (err instanceof AiConfigError || err instanceof AiSecretCryptoError) {
      throw err;
    }
    throw new AiConfigError(
      "AI_CONFIGURATION_INVALID",
      err instanceof Error ? err.message : "保存 profile 槽位失败",
    );
  }

  // Prefer the updated profile over any stale explicit modelConnection binding.
  await bindSlot(slotRaw, null, userId);

  const refreshed = await getConnection(id);
  if (!refreshed) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "保存后无法读取连接");
  }
  return toPublic(refreshed);
}

export async function setEnabled(
  id: string,
  enabled: boolean,
  userId: string,
): Promise<ModelConnectionPublic> {
  return updateConnection(id, { enabled }, userId);
}

export async function testConnection(
  id: string,
  options: { confirmPaid?: boolean } = {},
): Promise<{
  success: boolean;
  status: string;
  latencyMs: number;
  errorCode: string | null;
  testedAt: string;
  note?: string;
}> {
  const conn = await getConnectionOrThrow(id);
  const started = Date.now();
  const testedAt = new Date().toISOString();

  const finish = async (
    result: Omit<
      Awaited<ReturnType<typeof testConnection>>,
      never
    >,
  ) => {
    if (!conn.legacyVirtual) {
      const file = await readFileOrNull();
      if (file) {
        const idx = file.connections.findIndex((c) => c.id === id);
        if (idx >= 0) {
          file.connections[idx]!.lastTestStatus = result.success
            ? "success"
            : "failed";
          file.connections[idx]!.lastTestedAt = testedAt;
          file.connections[idx]!.lastTestMessage = result.status;
          await writeFile(file);
        }
      }
    }
    return result;
  };

  if (conn.providerMode === "mock") {
    return finish({
      success: true,
      status: "ok",
      latencyMs: Date.now() - started,
      errorCode: null,
      testedAt,
      note: "Mock 连接测试不访问外部网络",
    });
  }

  if (!conn.baseUrl?.trim()) {
    return finish({
      success: false,
      status: "missing_url",
      latencyMs: Date.now() - started,
      errorCode: "AI_CONFIGURATION_INVALID",
      testedAt,
    });
  }

  if (!isPlausibleApiKey(conn.apiKey)) {
    return finish({
      success: false,
      status: "missing_key",
      latencyMs: Date.now() - started,
      errorCode: "AI_MODEL_SECRET_MISSING",
      testedAt,
    });
  }

  if (!options.confirmPaid) {
    return finish({
      success: false,
      status: "confirm_required",
      latencyMs: Date.now() - started,
      errorCode: "AI_PAID_CONFIRMATION_REQUIRED",
      testedAt,
      note: "HTTP 测试可能产生 Provider 费用，请显式确认",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), conn.timeoutMs ?? 5000);
  try {
    const res = await fetch(conn.baseUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${conn.apiKey}` },
      signal: controller.signal,
    });
    return finish({
      success: res.status < 500,
      status: `http_${res.status}`,
      latencyMs: Date.now() - started,
      errorCode: res.status >= 500 ? "AI_PROVIDER_REQUEST_FAILED" : null,
      testedAt,
    });
  } catch {
    return finish({
      success: false,
      status: "network_error",
      latencyMs: Date.now() - started,
      errorCode: "AI_PROVIDER_REQUEST_FAILED",
      testedAt,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function listSlotBindings(): Promise<AiModelBinding[]> {
  const file = await readFileOrNull();
  const stored = file?.slotBindings ?? {};
  const now = new Date(0).toISOString();
  return GENERATION_API_DEFS.map((def) => ({
    profileSlot: def.id,
    modelConnectionId: stored[def.id] ?? null,
    updatedBy: "system",
    updatedAt: now,
  }));
}

export async function getSlotBinding(
  profileSlot: AiModelProfileSlotId,
): Promise<AiModelBinding> {
  const all = await listSlotBindings();
  const hit = all.find((b) => b.profileSlot === profileSlot);
  if (!hit) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "未知 profile slot");
  }
  return hit;
}

export async function bindSlot(
  profileSlot: AiModelProfileSlotId,
  modelConnectionId: string | null,
  userId: string,
): Promise<AiModelBinding> {
  if (modelConnectionId) {
    const conn = await getConnection(modelConnectionId);
    if (!conn) {
      throw new AiConfigError("AI_CONFIGURATION_INVALID", "模型连接不存在");
    }
    if (profileSlotModality(profileSlot) !== conn.modality) {
      throw new AiConfigError(
        "AI_CAPABILITY_MODALITY_MISMATCH",
        "模型模态与槽位不匹配",
      );
    }
    if (!SUPPORTED_PROVIDERS.has(conn.providerMode)) {
      throw new AiConfigError(
        "AI_MODEL_ADAPTER_UNAVAILABLE",
        "该 Provider 尚无运行时 Adapter",
      );
    }
  }
  const file = (await readFileOrNull()) ?? {
    schemaVersion: 1 as const,
    connections: [],
    slotBindings: {},
  };
  file.slotBindings[profileSlot] = modelConnectionId;
  await writeFile(file);
  return {
    profileSlot,
    modelConnectionId,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
}

/** Resolve connection for a profile slot: explicit binding → legacy virtual/default config. */
export async function resolveConnectionForSlot(
  profileSlot: AiModelProfileSlotId,
): Promise<ModelConnection> {
  const binding = await getSlotBinding(profileSlot);
  if (binding.modelConnectionId) {
    const conn = await getConnection(binding.modelConnectionId);
    if (!conn) {
      throw new AiConfigError("AI_MODEL_UNBOUND", "绑定的模型连接不存在");
    }
    if (!conn.enabled) {
      throw new AiConfigError(
        "AI_MODEL_CONNECTION_DISABLED",
        "模型连接已停用",
      );
    }
    if (!SUPPORTED_PROVIDERS.has(conn.providerMode)) {
      throw new AiConfigError(
        "AI_MODEL_ADAPTER_UNAVAILABLE",
        "Provider Adapter 不可用",
      );
    }
    if (
      (conn.providerMode === "http" || conn.providerMode === "aliyun-wan27") &&
      !isPlausibleApiKey(conn.apiKey)
    ) {
      throw new AiConfigError("AI_MODEL_SECRET_MISSING", "模型连接缺少 API Key");
    }
    return conn;
  }
  const legacyId = legacyConnectionId(profileSlot);
  const legacy = await getConnection(legacyId);
  if (legacy) {
    if (!legacy.enabled) {
      throw new AiConfigError(
        "AI_MODEL_CONNECTION_DISABLED",
        "legacy 模型配置已停用",
      );
    }
    return legacy;
  }
  const cfg = await getGenerationApiConfig(profileSlot);
  return {
    id: legacyId,
    displayName: cfg.label,
    modality: profileSlotModality(profileSlot),
    providerMode: cfg.provider as ModelProviderMode,
    baseUrl: cfg.apiUrl || null,
    endpointPath: null,
    modelId: cfg.model || null,
    endpointId: null,
    enabled: cfg.enabled !== false,
    apiKey: cfg.apiKey,
    timeoutMs: null,
    createdAt: cfg.updatedAt,
    updatedAt: cfg.updatedAt,
    lastTestStatus: "untested",
    lastTestedAt: null,
    lastTestMessage: null,
    legacyVirtual: true,
  };
}

export function isSupportedProviderMode(
  mode: string,
): mode is ModelProviderMode {
  return SUPPORTED_PROVIDERS.has(mode as ModelProviderMode);
}

export function normalizeProviderFromLegacy(
  provider: GenerationApiProvider,
  slotId: GenerationApiId,
): ModelProviderMode {
  if (provider === "http") return "http";
  if (provider === "aliyun-wan27" && slotId === "video-shot") {
    return "aliyun-wan27";
  }
  return "mock";
}
