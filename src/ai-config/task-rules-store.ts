import { createHash } from "crypto";
import { promises as fs } from "fs";
import {
  getAiCapability,
  type AiCapabilityId,
} from "@/ai-config/capabilities";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import { AiConfigError } from "@/ai-config/errors";
import { findTaskRuleOutputContractConflict } from "@/ai-config/task-rule-contract-guard";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  discardRemoteTaskRuleDraft,
  loadRemoteTaskRuleStore,
  publishRemoteTaskRule,
  rollbackRemoteTaskRule,
  saveRemoteTaskRuleDraft,
  revertRemoteTaskRuleToBuiltin,
  writeRemoteTaskRuleStore,
} from "@/ai-config/remote-task-rules-store";

export const MAX_RULE_CHARS = 256 * 1024;
export const TASK_RULES_SCHEMA_VERSION = 1;

export type TaskRuleSourceType = "manual" | "markdown";

export type TaskRuleDraft = {
  content: string;
  sourceType: TaskRuleSourceType;
  sourceFileName: string | null;
  revision: number;
  updatedBy: string;
  updatedAt: string;
};

export type TaskRulePublishedVersion = {
  version: number;
  content: string;
  contentHash: string;
  sourceType: TaskRuleSourceType | "rollback" | "use-builtin";
  sourceFileName: string | null;
  publishedBy: string;
  publishedAt: string;
  rolledBackFromVersion: number | null;
};

export type TaskRuleRecord = {
  capabilityId: AiCapabilityId;
  draft: TaskRuleDraft | null;
  publishedVersion: number | null;
  versions: TaskRulePublishedVersion[];
  lastPublishIdempotencyKey?: string | null;
  lastRollbackIdempotencyKey?: string | null;
};

export type AiTaskRuleStore = {
  schemaVersion: 1;
  rules: Record<string, TaskRuleRecord>;
};

export type EffectivePublishedRule = {
  source: "builtin" | "custom";
  version: number | null;
  content: string;
  contentHash: string;
};

export type EffectiveTaskRuleSource = EffectivePublishedRule["source"];

export function hashTaskRuleContent(content: string): string {
  return hashRuleContent(content);
}

export type RuleCheckSeverity = "error" | "warning" | "info";

export type RuleCheckItem = {
  severity: RuleCheckSeverity;
  code: string;
  message: string;
};

export type RuleCheckResult = {
  errors: RuleCheckItem[];
  warnings: RuleCheckItem[];
  infos: RuleCheckItem[];
};

function storeFilePath(): string {
  return resolveAppDataPath("ai-task-rules.json");
}

export function hashRuleContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function normalizeMarkdownText(raw: string): string {
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function validateImportedMarkdownText(
  raw: string,
  byteLength?: number,
): { content: string } | { error: string; code: string } {
  const len = byteLength ?? Buffer.byteLength(raw, "utf8");
  if (len === 0) {
    return { error: "文件内容为空", code: "AI_TASK_RULE_MARKDOWN_INVALID" };
  }
  if (len > MAX_RULE_CHARS) {
    return { error: "文件超过 256 KiB 限制", code: "AI_TASK_RULE_TOO_LARGE" };
  }
  try {
    const content = normalizeMarkdownText(raw);
    if (!content.trim()) {
      return { error: "文件内容为空", code: "AI_TASK_RULE_MARKDOWN_INVALID" };
    }
    if (content.length > MAX_RULE_CHARS) {
      return { error: "规则内容超过字符限制", code: "AI_TASK_RULE_TOO_LARGE" };
    }
    return { content };
  } catch {
    return { error: "无法解码为 UTF-8", code: "AI_TASK_RULE_MARKDOWN_INVALID" };
  }
}

function emptyStore(): AiTaskRuleStore {
  return { schemaVersion: 1, rules: {} };
}

function emptyRecord(capabilityId: AiCapabilityId): TaskRuleRecord {
  return {
    capabilityId,
    draft: null,
    publishedVersion: null,
    versions: [],
  };
}

/** Read store from disk; missing file → empty in-memory (no create). */
export async function loadStore(): Promise<AiTaskRuleStore> {
  if (isRemoteDataOnly()) {
    return loadRemoteTaskRuleStore();
  }
  try {
    const raw = await fs.readFile(storeFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as AiTaskRuleStore;
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.rules !== "object") {
      return emptyStore();
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStore();
    throw new AiConfigError(
      "AI_TASK_RULE_CONFIG_INVALID",
      "任务规则配置文件损坏",
    );
  }
}

async function writeStore(store: AiTaskRuleStore): Promise<void> {
  if (isRemoteDataOnly()) {
    return writeRemoteTaskRuleStore();
  }
  await fs.mkdir(resolveAppDataPath(), { recursive: true });
  const file = storeFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function assertCapabilityId(id: string): AiCapabilityId {
  const cap = getAiCapability(id);
  if (!cap) {
    throw new AiConfigError("AI_CAPABILITY_UNKNOWN", `未知 capability：${id}`);
  }
  return cap.id;
}

export async function getRuleRecord(
  capabilityId: string,
): Promise<TaskRuleRecord> {
  const id = assertCapabilityId(capabilityId);
  const store = await loadStore();
  return store.rules[id] ?? emptyRecord(id);
}

export async function getEffectivePublishedRule(
  capabilityId: string,
): Promise<EffectivePublishedRule> {
  const id = assertCapabilityId(capabilityId);
  const store = await loadStore();
  const record = store.rules[id];
  if (!record || record.publishedVersion === null) {
    const builtin = getBuiltinTaskRule(id);
    return {
      source: "builtin",
      version: null,
      content: builtin,
      contentHash: hashRuleContent(builtin),
    };
  }
  const published = record.versions.find(
    (v) => v.version === record.publishedVersion,
  );
  if (!published) {
    throw new AiConfigError(
      "AI_TASK_RULE_CONFIG_INVALID",
      "已发布规则版本缺失或损坏",
    );
  }
  return {
    source: "custom",
    version: published.version,
    content: published.content,
    contentHash: published.contentHash,
  };
}

export function checkRule(
  content: string,
  capabilityId?: AiCapabilityId | string | null,
): RuleCheckResult {
  const errors: RuleCheckItem[] = [];
  const warnings: RuleCheckItem[] = [];
  const infos: RuleCheckItem[] = [];

  const trimmed = content.trim();
  if (!trimmed) {
    errors.push({
      severity: "error",
      code: "EMPTY",
      message: "规则内容不能为空",
    });
  }
  if (content.length > MAX_RULE_CHARS) {
    errors.push({
      severity: "error",
      code: "TOO_LARGE",
      message: `规则超过 ${MAX_RULE_CHARS} 字符限制`,
    });
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) {
    errors.push({
      severity: "error",
      code: "CONTROL_CHARS",
      message: "包含非法控制字符",
    });
  }

  const forbiddenPatterns: Array<{ re: RegExp; msg: string }> = [
    { re: /api[_\s-]?key/i, msg: "不得要求配置或泄露 API Key" },
    { re: /sk-[a-zA-Z0-9]{8,}/, msg: "不得包含疑似 API Key 片段" },
    { re: /忽略.*(规则|权限|schema)/i, msg: "不得要求跳过系统规则或 Schema" },
    { re: /绕过.*(付费|权限|门禁)/i, msg: "不得要求绕过付费或权限门禁" },
    { re: /planned.*active|改为\s*active/i, msg: "不得要求将 planned 功能激活" },
    {
      re: /\{\{[^}]+\}\}|\$\{[^}]+\}/,
      msg: "不支持动态模板变量（如 {{episodeText}}）",
    },
  ];
  for (const { re, msg } of forbiddenPatterns) {
    if (re.test(content)) {
      errors.push({ severity: "error", code: "FORBIDDEN_INSTRUCTION", message: msg });
    }
  }

  if (/改写.*正文|润色.*剧本|输出完整剧本/i.test(content)) {
    warnings.push({
      severity: "warning",
      code: "CONTRACT_CONFLICT",
      message: "可能与不可修改输出契约冲突（如 script.split 不得改写正文）",
    });
  }
  if (/生成图片|输出.*png|base64/i.test(content)) {
    warnings.push({
      severity: "warning",
      code: "CONTRACT_CONFLICT",
      message: "文本资产提取任务不应要求直接生成图片或二进制",
    });
  }

  const resolvedCapability =
    typeof capabilityId === "string" && capabilityId.trim()
      ? getAiCapability(capabilityId)?.id
      : null;
  if (resolvedCapability) {
    const contractConflict = findTaskRuleOutputContractConflict(
      resolvedCapability,
      content,
    );
    if (contractConflict) {
      errors.push({
        severity: "error",
        code: contractConflict.code,
        message: `${contractConflict.message}（冲突语义：${contractConflict.patterns.join("、")}）`,
      });
    }
  }

  if (trimmed.length > 0 && trimmed.length < 20) {
    infos.push({
      severity: "info",
      code: "SHORT",
      message: "规则较短，可能不足以指导模型",
    });
  }

  return { errors, warnings, infos };
}

export async function saveDraft(
  capabilityId: string,
  content: string,
  sourceType: TaskRuleSourceType,
  sourceFileName: string | null,
  expectedRevision: number | null,
  userId: string,
): Promise<{ revision: number }> {
  const id = assertCapabilityId(capabilityId);
  if (isRemoteDataOnly()) {
    return saveRemoteTaskRuleDraft({
      capabilityId: id,
      content,
      sourceType,
      sourceFileName,
      expectedRevision,
      userId,
    });
  }
  if (content.length > MAX_RULE_CHARS) {
    throw new AiConfigError("AI_TASK_RULE_TOO_LARGE", "规则内容过大");
  }
  const store = await loadStore();
  const record = store.rules[id] ?? emptyRecord(id);
  const currentRevision = record.draft?.revision ?? 0;
  if (expectedRevision !== null && expectedRevision !== currentRevision) {
    throw new AiConfigError(
      "AI_TASK_RULE_REVISION_CONFLICT",
      "草稿 revision 冲突，请刷新后重试",
    );
  }
  const nextRevision = currentRevision + 1;
  record.draft = {
    content: normalizeMarkdownText(content),
    sourceType,
    sourceFileName,
    revision: nextRevision,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
  store.rules[id] = record;
  await writeStore(store);
  return { revision: nextRevision };
}

export async function discardDraft(capabilityId: string): Promise<void> {
  const id = assertCapabilityId(capabilityId);
  if (isRemoteDataOnly()) return discardRemoteTaskRuleDraft(id);
  const store = await loadStore();
  const record = store.rules[id];
  if (!record?.draft) return;
  record.draft = null;
  store.rules[id] = record;
  await writeStore(store);
}

export async function publishRule(
  capabilityId: string,
  expectedRevision: number | null,
  idempotencyKey: string,
  userId: string,
): Promise<{ version: number; contentHash: string }> {
  const id = assertCapabilityId(capabilityId);
  if (isRemoteDataOnly()) {
    return publishRemoteTaskRule({
      capabilityId: id,
      expectedRevision,
      idempotencyKey,
      userId,
    });
  }
  const store = await loadStore();
  const record = store.rules[id] ?? emptyRecord(id);
  if (
    idempotencyKey &&
    record.lastPublishIdempotencyKey === idempotencyKey &&
    record.publishedVersion !== null
  ) {
    const existing = record.versions.find(
      (v) => v.version === record.publishedVersion,
    );
    if (existing) {
      return { version: existing.version, contentHash: existing.contentHash };
    }
  }
  const content = record.draft?.content;
  if (!content?.trim()) {
    throw new AiConfigError("AI_TASK_RULE_CONFIG_INVALID", "没有可发布的草稿内容");
  }
  if (
    expectedRevision !== null &&
    record.draft &&
    expectedRevision !== record.draft.revision
  ) {
    throw new AiConfigError(
      "AI_TASK_RULE_REVISION_CONFLICT",
      "草稿 revision 冲突，请刷新后重试",
    );
  }
  const check = checkRule(content, id);
  if (check.errors.length > 0) {
    throw new AiConfigError(
      "AI_TASK_RULE_CONFIG_INVALID",
      check.errors.map((e) => e.message).join("；"),
    );
  }
  const nextVersion =
    record.versions.length > 0
      ? Math.max(...record.versions.map((v) => v.version)) + 1
      : 1;
  const contentHash = hashRuleContent(content);
  const now = new Date().toISOString();
  const sourceType = record.draft?.sourceType ?? "manual";
  const sourceFileName = record.draft?.sourceFileName ?? null;
  const versionEntry: TaskRulePublishedVersion = {
    version: nextVersion,
    content,
    contentHash,
    sourceType,
    sourceFileName,
    publishedBy: userId,
    publishedAt: now,
    rolledBackFromVersion: null,
  };
  record.versions.push(versionEntry);
  record.publishedVersion = nextVersion;
  record.draft = null;
  record.lastPublishIdempotencyKey = idempotencyKey || null;
  store.rules[id] = record;
  await writeStore(store);
  return { version: nextVersion, contentHash };
}

export async function listVersions(
  capabilityId: string,
): Promise<TaskRulePublishedVersion[]> {
  const record = await getRuleRecord(capabilityId);
  return [...record.versions].sort((a, b) => b.version - a.version);
}

export async function rollbackRule(
  capabilityId: string,
  toVersion: number,
  idempotencyKey: string,
  userId: string,
): Promise<{ version: number; contentHash: string }> {
  const id = assertCapabilityId(capabilityId);
  if (isRemoteDataOnly()) {
    return rollbackRemoteTaskRule({
      capabilityId: id,
      toVersion,
      idempotencyKey,
      userId,
    });
  }
  const store = await loadStore();
  const record = store.rules[id] ?? emptyRecord(id);
  if (
    idempotencyKey &&
    record.lastRollbackIdempotencyKey === idempotencyKey &&
    record.publishedVersion !== null
  ) {
    const existing = record.versions.find(
      (v) => v.version === record.publishedVersion,
    );
    if (existing?.rolledBackFromVersion === toVersion) {
      return { version: existing.version, contentHash: existing.contentHash };
    }
  }
  const target = record.versions.find((v) => v.version === toVersion);
  if (!target) {
    throw new AiConfigError("AI_TASK_RULE_CONFIG_INVALID", "目标历史版本不存在");
  }
  const nextVersion =
    record.versions.length > 0
      ? Math.max(...record.versions.map((v) => v.version)) + 1
      : 1;
  const contentHash = hashRuleContent(target.content);
  const now = new Date().toISOString();
  const versionEntry: TaskRulePublishedVersion = {
    version: nextVersion,
    content: target.content,
    contentHash,
    sourceType: "rollback",
    sourceFileName: target.sourceFileName,
    publishedBy: userId,
    publishedAt: now,
    rolledBackFromVersion: toVersion,
  };
  record.versions.push(versionEntry);
  record.publishedVersion = nextVersion;
  record.lastRollbackIdempotencyKey = idempotencyKey || null;
  store.rules[id] = record;
  await writeStore(store);
  return { version: nextVersion, contentHash };
}

export async function revertCapabilityToBuiltin(
  capabilityId: string,
  userId: string,
): Promise<void> {
  const id = assertCapabilityId(capabilityId);
  if (isRemoteDataOnly()) return revertRemoteTaskRuleToBuiltin(id, userId);
  const store = await loadStore();
  const record = store.rules[id] ?? emptyRecord(id);
  record.publishedVersion = null;
  record.draft = null;
  const nextVersion =
    record.versions.length > 0
      ? Math.max(...record.versions.map((v) => v.version)) + 1
      : 1;
  const now = new Date().toISOString();
  record.versions.push({
    version: nextVersion,
    content: "",
    contentHash: hashRuleContent(""),
    sourceType: "use-builtin",
    sourceFileName: null,
    publishedBy: userId,
    publishedAt: now,
    rolledBackFromVersion: null,
  });
  store.rules[id] = record;
  await writeStore(store);
}

export async function listAllRuleSummaries(): Promise<
  Array<{
    capabilityId: AiCapabilityId;
    hasDraft: boolean;
    draftRevision: number | null;
    publishedVersion: number | null;
    publishedSource: "builtin" | "custom";
    versionCount: number;
  }>
> {
  const store = await loadStore();
  const { AI_CAPABILITIES } = await import("@/ai-config/capabilities");
  return AI_CAPABILITIES.map((cap) => {
    const record = store.rules[cap.id];
    const publishedSource =
      record?.publishedVersion !== null && record?.publishedVersion !== undefined
        ? "custom"
        : "builtin";
    return {
      capabilityId: cap.id,
      hasDraft: !!record?.draft,
      draftRevision: record?.draft?.revision ?? null,
      publishedVersion: record?.publishedVersion ?? null,
      publishedSource,
      versionCount: record?.versions.length ?? 0,
    };
  });
}
