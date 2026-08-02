import "server-only";

import type { AiCapabilityId } from "@/ai-config/capabilities";
import { AiConfigError, type AiConfigErrorCode } from "@/ai-config/errors";
import type {
  AiTaskRuleStore,
  TaskRuleRecord,
  TaskRuleSourceType,
} from "@/ai-config/task-rules-store";
import { requestRemoteData } from "@/persistence/remote-data-client";

async function taskRuleRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { code?: AiConfigErrorCode; error?: string }
      | null;
    if (payload?.code) {
      throw new AiConfigError(
        payload.code,
        payload.error ?? "AI task rule request failed",
      );
    }
    throw new Error(`REMOTE_TASK_RULE_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadRemoteTaskRuleStore(): Promise<AiTaskRuleStore> {
  const result = await taskRuleRequest<AiTaskRuleStore>("/v1/ai-task-rules");
  return { schemaVersion: 1, rules: result.rules ?? {} };
}

export async function getRemoteTaskRuleRecord(
  capabilityId: AiCapabilityId,
): Promise<TaskRuleRecord> {
  const result = await taskRuleRequest<{ record: TaskRuleRecord }>(
    `/v1/ai-task-rules/${encodeURIComponent(capabilityId)}`,
  );
  return result.record;
}

export async function saveRemoteTaskRuleDraft(input: {
  capabilityId: AiCapabilityId;
  content: string;
  sourceType: TaskRuleSourceType;
  sourceFileName: string | null;
  expectedRevision: number | null;
  userId: string;
}): Promise<{ revision: number }> {
  return taskRuleRequest(
    `/v1/ai-task-rules/${encodeURIComponent(input.capabilityId)}/draft`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function discardRemoteTaskRuleDraft(
  capabilityId: AiCapabilityId,
): Promise<void> {
  await taskRuleRequest(
    `/v1/ai-task-rules/${encodeURIComponent(capabilityId)}/draft`,
    { method: "DELETE" },
  );
}

export function publishRemoteTaskRule(input: {
  capabilityId: AiCapabilityId;
  expectedRevision: number | null;
  idempotencyKey: string;
  userId: string;
}): Promise<{ version: number; contentHash: string }> {
  return taskRuleRequest(
    `/v1/ai-task-rules/${encodeURIComponent(input.capabilityId)}/publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function rollbackRemoteTaskRule(input: {
  capabilityId: AiCapabilityId;
  toVersion: number;
  idempotencyKey: string;
  userId: string;
}): Promise<{ version: number; contentHash: string }> {
  return taskRuleRequest(
    `/v1/ai-task-rules/${encodeURIComponent(input.capabilityId)}/rollback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function revertRemoteTaskRuleToBuiltin(
  capabilityId: AiCapabilityId,
  userId: string,
): Promise<void> {
  await taskRuleRequest(
    `/v1/ai-task-rules/${encodeURIComponent(capabilityId)}/use-builtin`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    },
  );
}


export async function writeRemoteTaskRuleStore(): Promise<void> {
  throw new Error("REMOTE_TASK_RULE_DIRECT_WRITE_FORBIDDEN");
}