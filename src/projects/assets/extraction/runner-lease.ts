import { randomUUID } from "crypto";
import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";
import {
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";
import { isLiveExtractionStatus } from "@/projects/assets/extraction/types";

export function isRunnerLeaseActive(
  task: Pick<AssetExtractionTask, "runnerLeaseUntil">,
  nowMs = Date.now(),
): boolean {
  const until = task.runnerLeaseUntil?.trim();
  if (!until) return false;
  const ms = Date.parse(until);
  if (!Number.isFinite(ms)) return false;
  return ms > nowMs;
}

export function isRunnerHeartbeatStale(
  task: Pick<AssetExtractionTask, "heartbeatAt" | "updatedAt" | "status">,
  nowMs = Date.now(),
): boolean {
  if (!isLiveExtractionStatus(task.status)) return false;
  const stamp = task.heartbeatAt?.trim() || task.updatedAt?.trim();
  if (!stamp) return true;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms > ASSET_EXTRACTION_POLICY.runnerStaleMs;
}

function leaseUntilIso(fromMs = Date.now()): string {
  return new Date(fromMs + ASSET_EXTRACTION_POLICY.runnerLeaseMs).toISOString();
}

export type ClaimRunnerLeaseResult =
  | { ok: true; task: AssetExtractionTask; runnerId: string }
  | { ok: false; reason: "TASK_NOT_FOUND" | "NOT_LIVE" | "LEASE_HELD" };

/**
 * Atomically claim an exclusive runner lease for a live extraction task.
 * Expired leases can be taken over after a process restart.
 */
export async function claimAssetExtractionRunnerLease(input: {
  projectId: string;
  taskId: string;
  runnerId?: string;
}): Promise<ClaimRunnerLeaseResult> {
  const runnerId = input.runnerId?.trim() || randomUUID();
  let claimed: AssetExtractionTask | null = null;
  let reason: "TASK_NOT_FOUND" | "NOT_LIVE" | "LEASE_HELD" | null = null;

  await mutateAssetExtractionStore(input.projectId, (store) => {
    const task = store.tasks.find((item) => item.id === input.taskId) ?? null;
    if (!task) {
      reason = "TASK_NOT_FOUND";
      return store;
    }
    if (!isLiveExtractionStatus(task.status)) {
      reason = "NOT_LIVE";
      return store;
    }
    if (
      isRunnerLeaseActive(task) &&
      task.runnerId &&
      task.runnerId !== runnerId
    ) {
      reason = "LEASE_HELD";
      return store;
    }
    const now = new Date().toISOString();
    const updated: AssetExtractionTask = {
      ...task,
      runnerId,
      runnerLeaseUntil: leaseUntilIso(),
      heartbeatAt: now,
      // Reset interrupted in-flight detail rows so resume can requeue them.
      detailItems: (task.detailItems ?? []).map((item) =>
        item.status === "running"
          ? { ...item, status: "pending" as const }
          : item,
      ),
      revision: task.revision + 1,
      updatedAt: now,
    };
    claimed = updated;
    return {
      ...store,
      tasks: store.tasks.map((item) =>
        item.id === task.id ? updated : item,
      ),
    };
  });

  if (claimed) {
    return { ok: true, task: claimed, runnerId };
  }
  return { ok: false, reason: reason ?? "LEASE_HELD" };
}

export async function renewAssetExtractionRunnerLease(input: {
  projectId: string;
  taskId: string;
  runnerId: string;
}): Promise<boolean> {
  let renewed = false;
  await mutateAssetExtractionStore(input.projectId, (store) => {
    const task = store.tasks.find((item) => item.id === input.taskId) ?? null;
    if (!task) return store;
    if (task.runnerId !== input.runnerId) return store;
    if (!isLiveExtractionStatus(task.status)) return store;
    const now = new Date().toISOString();
    renewed = true;
    return {
      ...store,
      tasks: store.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              heartbeatAt: now,
              runnerLeaseUntil: leaseUntilIso(),
              revision: item.revision + 1,
              updatedAt: now,
            }
          : item,
      ),
    };
  });
  return renewed;
}

export async function releaseAssetExtractionRunnerLease(input: {
  projectId: string;
  taskId: string;
  runnerId: string;
}): Promise<void> {
  await mutateAssetExtractionStore(input.projectId, (store) => {
    const task = store.tasks.find((item) => item.id === input.taskId) ?? null;
    if (!task) return store;
    if (task.runnerId && task.runnerId !== input.runnerId) return store;
    const now = new Date().toISOString();
    return {
      ...store,
      tasks: store.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              runnerId: null,
              runnerLeaseUntil: null,
              heartbeatAt: now,
              revision: item.revision + 1,
              updatedAt: now,
            }
          : item,
      ),
    };
  });
}
