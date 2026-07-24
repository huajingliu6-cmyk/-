import {
  listGenerationRecords,
  readGenerationRecord,
  updateGenerationRecord,
} from "../generation-store";
import type { GenerationRecord } from "../types";
import { SUBMITTING_STALE_MS } from "./constants";
import { IdempotencyError } from "./errors";
import { FileGenerationIdempotencyStore } from "./file-store";
import { getIdempotencyStore } from "./store-registry";
import type { IdempotencyRecord, IdempotencyScope } from "./types";

export type ReconcileResult = {
  record: IdempotencyRecord;
  generation: GenerationRecord | null;
  /** 本轮是否改写了幂等或 generation */
  mutated: boolean;
  note: string;
};

/**
 * 对账持久幂等记录与 GenerationRecord。
 * 永不在恢复流程中重新调用 Provider。
 */
export async function reconcileGenerationIdempotencyRecord(params: {
  scope: IdempotencyScope;
  idempotencyKey: string;
}): Promise<ReconcileResult> {
  const store = getIdempotencyStore();
  let record: IdempotencyRecord | null;
  try {
    record = await store.get(params.scope, params.idempotencyKey);
  } catch (err) {
    if (err instanceof IdempotencyError) throw err;
    throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
  }
  if (!record) {
    throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE", {
      message: "未找到对应的幂等记录",
    });
  }

  const generation = await readGenerationRecord(record.generationId);
  let mutated = false;
  let note = "无变更";

  switch (record.state) {
    case "committed": {
      return {
        record,
        generation,
        mutated: false,
        note: "已提交完成，返回已有 generation",
      };
    }
    case "providerAccepted": {
      if (
        generation &&
        record.providerTaskId &&
        !generation.providerTaskId
      ) {
        const patched = await updateGenerationRecord(generation.id, {
          providerTaskId: record.providerTaskId,
          status:
            generation.status === "validating" ||
            generation.status === "submitting"
              ? "queued"
              : generation.status,
          progressLabel:
            generation.progressLabel || "已从幂等记录恢复 Provider 任务号",
          errorCode: null,
          errorMessage: null,
        });
        mutated = true;
        note = "已从幂等记录补写 providerTaskId";
        return { record, generation: patched, mutated, note };
      }
      return {
        record,
        generation,
        mutated: false,
        note: "providerAccepted，generation 已有或暂无记录可补写",
      };
    }
    case "submitting": {
      const age = Date.now() - Date.parse(record.updatedAt);
      if (!Number.isFinite(age) || age < SUBMITTING_STALE_MS) {
        return {
          record,
          generation,
          mutated: false,
          note: "submitting 未超时，保持 in-progress，不调用 Provider",
        };
      }
      // 长时间未完成：有 taskId → providerAccepted；无 → unknownOutcome。不重放 Provider。
      if (record.providerTaskId) {
        const next = await store.markProviderAccepted(
          record.scope,
          record.idempotencyKey,
          record.generationId,
          record.providerTaskId,
        );
        if (generation && !generation.providerTaskId) {
          const patched = await updateGenerationRecord(generation.id, {
            providerTaskId: record.providerTaskId,
          });
          return {
            record: next,
            generation: patched,
            mutated: true,
            note: "stale submitting 含 taskId → providerAccepted 并补写",
          };
        }
        return {
          record: next,
          generation,
          mutated: true,
          note: "stale submitting 含 taskId → providerAccepted",
        };
      }
      const next = await store.markUnknownOutcome(
        record.scope,
        record.idempotencyKey,
        record.generationId,
        "SUBMITTING_STALE_UNKNOWN",
      );
      let gen = generation;
      if (generation) {
        gen = await updateGenerationRecord(generation.id, {
          status: "unknownOutcome",
          errorCode: "GENERATION_SUBMISSION_UNKNOWN",
          errorMessage:
            "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
          progressLabel: "提交结果待确认",
        });
      }
      return {
        record: next,
        generation: gen,
        mutated: true,
        note: "stale submitting 无 taskId → unknownOutcome，不重试 Provider",
      };
    }
    case "unknownOutcome": {
      return {
        record,
        generation,
        mutated: false,
        note: "unknownOutcome 保持阻塞，不自动重试",
      };
    }
    case "safeFailure": {
      return {
        record,
        generation,
        mutated: false,
        note: "safeFailure：仅允许在明确未调用 Provider 的规则下重试",
      };
    }
    case "reserved": {
      const age = Date.now() - Date.parse(record.updatedAt);
      if (Number.isFinite(age) && age >= SUBMITTING_STALE_MS) {
        const next = await store.markSafeFailure(
          record.scope,
          record.idempotencyKey,
          record.generationId,
          "RESERVED_STALE",
        );
        return {
          record: next,
          generation,
          mutated: true,
          note: "reserved 超时且未提交 Provider → safeFailure",
        };
      }
      return {
        record,
        generation,
        mutated: false,
        note: "reserved 进行中",
      };
    }
    default: {
      const _exhaustive: never = record.state;
      void _exhaustive;
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
  }
}

/** 按 generationId 查找幂等记录并对账（GET generation / 管理入口） */
export async function reconcileByGenerationId(
  generationId: string,
): Promise<ReconcileResult | null> {
  const store = getIdempotencyStore();
  if (!(store instanceof FileGenerationIdempotencyStore)) {
    // 非文件后端：仅能通过 generation.idempotencyKey 对账
    const generation = await readGenerationRecord(generationId);
    if (!generation?.idempotencyKey) return null;
    return reconcileGenerationIdempotencyRecord({
      scope: "video-generation",
      idempotencyKey: generation.idempotencyKey,
    });
  }
  const all = await store.listAll();
  const hit = all.find((r) => r.generationId === generationId);
  if (!hit) {
    const generation = await readGenerationRecord(generationId);
    if (!generation?.idempotencyKey) return null;
    return reconcileGenerationIdempotencyRecord({
      scope: "video-generation",
      idempotencyKey: generation.idempotencyKey,
    });
  }
  return reconcileGenerationIdempotencyRecord({
    scope: hit.scope,
    idempotencyKey: hit.idempotencyKey,
  });
}

const ACTIVE_GENERATION_STATUSES = new Set([
  "validating",
  "queued",
  "processing",
  "downloading",
  "submitting",
  "unknownOutcome",
]);

/**
 * 同 projectId + shotNodeId + providerId 存在 active 任务时阻止第二单。
 * 不开放管理员强制并行。
 */
export async function findActiveGenerationForShot(params: {
  projectId: string;
  shotNodeId: string;
  providerId: string;
  /** 幂等命中同一 generation 时排除自身 */
  excludeGenerationId?: string;
}): Promise<GenerationRecord | null> {
  const records = await listGenerationRecords();
  for (const record of records) {
    if (
      params.excludeGenerationId &&
      record.id === params.excludeGenerationId
    ) {
      continue;
    }
    if (
      record.projectId === params.projectId &&
      record.shotNodeId === params.shotNodeId &&
      record.providerId === params.providerId &&
      ACTIVE_GENERATION_STATUSES.has(record.status)
    ) {
      return record;
    }
  }

  // 幂等层：unknownOutcome / submitting 也可能尚未写成 generation active
  const store = getIdempotencyStore();
  if (store instanceof FileGenerationIdempotencyStore) {
    const all = await store.listAll();
    for (const idem of all) {
      if (
        idem.projectId === params.projectId &&
        idem.shotNodeId === params.shotNodeId &&
        idem.providerId === params.providerId &&
        (idem.state === "submitting" ||
          idem.state === "reserved" ||
          idem.state === "unknownOutcome" ||
          idem.state === "providerAccepted")
      ) {
        if (
          params.excludeGenerationId &&
          idem.generationId === params.excludeGenerationId
        ) {
          continue;
        }
        const gen = await readGenerationRecord(idem.generationId);
        if (gen && ACTIVE_GENERATION_STATUSES.has(gen.status)) {
          return gen;
        }
        if (!gen && idem.state === "unknownOutcome") {
          // 合成阻断：无 generation 文件时仍阻止同镜头新 key
          return {
            id: idem.generationId,
            projectId: idem.projectId,
            shotNodeId: idem.shotNodeId,
            providerId: idem.providerId as GenerationRecord["providerId"],
            providerModelId: "",
            providerTaskId: idem.providerTaskId ?? "",
            mode: "textToVideo",
            status: "unknownOutcome",
            progress: null,
            progressLabel: "提交结果待确认",
            isMock: idem.providerId === "mock",
            requestSnapshot: {
              prompt: "",
              settings: {
                resolution: "720P",
                aspectRatio: "9:16",
                durationSeconds: 5,
                watermark: false,
                promptExtend: true,
              },
              mediaAssetIds: [],
              unsupportedAudioLabels: [],
            },
            requestedResolution: "720P",
            requestedAspectRatio: "9:16",
            requestedDurationSeconds: 5,
            providerResolution: null,
            providerAspectRatio: null,
            providerDurationSeconds: null,
            actualWidth: null,
            actualHeight: null,
            actualDurationSeconds: null,
            metadataSource: "none",
            remoteVideoUrl: null,
            localVideoAssetId: null,
            resultAsset: null,
            errorCode: "GENERATION_SUBMISSION_UNKNOWN",
            errorMessage:
              "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
            createdAt: idem.createdAt,
            updatedAt: idem.updatedAt,
            completedAt: null,
            idempotencyKey: idem.idempotencyKey,
          };
        }
      }
    }
  }

  return null;
}

export { ACTIVE_GENERATION_STATUSES };
