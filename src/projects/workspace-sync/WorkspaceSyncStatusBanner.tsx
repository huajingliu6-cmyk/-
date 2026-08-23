"use client";

import { useCallback, useEffect, useState } from "react";
import { RetryableOperationErrorCard } from "@/projects/RetryableOperationErrorCard";

type SyncConflict = {
  entityType: string;
  entityId: string;
  field: string;
  baseValue: unknown;
  managementValue: unknown;
  workspaceValue: unknown;
  managementRevision: number;
  workspaceRevision: number;
  operationId: string;
  status?: "open" | "resolved";
  mergeOperationId?: string;
};

type SyncItem = {
  kind: string;
  syncStatus: "ok" | "pending" | "failed" | "unknown" | "conflict" | "committed";
  sourceStore: string;
  targetStore: string;
  scope: string;
  reason: string | null;
  operationId: string | null;
  statusUrl: string | null;
  retryPath: string;
  entityId?: string | null;
  conflicts?: SyncConflict[];
};

type SyncStatus = {
  syncStatus: SyncItem["syncStatus"];
  syncError: string | null;
  operationId: string | null;
  retryPath: string;
  items?: SyncItem[];
};

function statusLabel(item: Pick<SyncItem, "syncStatus" | "kind" | "reason">): string {
  if (item.syncStatus === "unknown" || item.syncStatus === "failed") {
    if (item.kind === "media-metadata-sync") {
      return item.reason?.startsWith("待补齐")
        ? item.reason
        : "待补齐资产 metadata";
    }
    return "同步失败";
  }
  if (item.kind === "media-metadata-sync") {
    if (item.syncStatus === "committed" || item.syncStatus === "ok") {
      return "已完成";
    }
    if (item.syncStatus === "pending") return "进行中";
    return item.reason?.startsWith("待补齐")
      ? item.reason
      : "待补齐资产 metadata";
  }
  if (item.kind === "workspace-conflict-resolution") {
    if (item.syncStatus === "pending") return "进行中";
    if (item.syncStatus === "committed" || item.syncStatus === "ok") return "已完成";
  }
  switch (item.syncStatus) {
    case "pending":
      return "同步进行中";
    case "conflict":
      return "双向合并冲突";
    case "committed":
    case "ok":
      return "已同步";
    default:
      return item.syncStatus;
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return "（无）";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseManualValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

export function WorkspaceSyncStatusBanner({
  projectId,
  store = "workspace",
}: {
  projectId: string;
  store?: "workspace" | "management";
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [showOperationFailed, setShowOperationFailed] = useState(false);
  const statusPath =
    store === "management"
      ? `/api/projects/${encodeURIComponent(projectId)}/sync-status`
      : `/api/workspace/projects/${encodeURIComponent(projectId)}/sync-status`;
  const conflictsPath =
    store === "management"
      ? `/api/projects/${encodeURIComponent(projectId)}/sync-conflicts`
      : `/api/workspace/projects/${encodeURIComponent(projectId)}/sync-conflicts`;

  const loadConflicts = useCallback(async () => {
    const response = await fetch(conflictsPath, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { conflicts?: SyncConflict[] };
    setConflicts((body.conflicts ?? []).filter((item) => (item.status ?? "open") === "open"));
  }, [conflictsPath]);

  const load = useCallback(async () => {
    const response = await fetch(statusPath, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as SyncStatus;
    setStatus(body);
    await loadConflicts();
  }, [statusPath, loadConflicts]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(statusPath, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as SyncStatus;
      if (!cancelled) setStatus(body);
      const conflictResponse = await fetch(conflictsPath, { cache: "no-store" });
      if (!conflictResponse.ok || cancelled) return;
      const conflictBody = (await conflictResponse.json()) as {
        conflicts?: SyncConflict[];
      };
      if (!cancelled) {
        setConflicts(
          (conflictBody.conflicts ?? []).filter(
            (item) => (item.status ?? "open") === "open",
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusPath, conflictsPath]);

  const retry = async (path?: string) => {
    const retryPath = path || status?.retryPath;
    if (!retryPath) return;
    setBusy(true);
    setShowOperationFailed(false);
    setResolveError(null);
    try {
      const response = await fetch(retryPath, { method: "POST" });
      if (response.ok) {
        const body = (await response.json()) as SyncStatus;
        setStatus(body);
        await loadConflicts();
        return;
      }
      const err = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
      } | null;
      if (err?.code === "OPERATION_FAILED") {
        setShowOperationFailed(true);
      } else {
        setResolveError(err?.error || err?.code || "同步失败，请重新操作");
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const resolveConflict = async (
    conflict: SyncConflict,
    choice: "management" | "workspace" | "manual",
  ) => {
    setBusy(true);
    setResolveError(null);
    setShowOperationFailed(false);
    try {
      const key = `${conflict.entityType}:${conflict.entityId}:${conflict.field}`;
      const body: Record<string, unknown> = {
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        field: conflict.field,
        choice,
      };
      if (choice === "manual") {
        body.value = parseManualValue(manualValues[key] ?? "");
      }
      const response = await fetch(conflictsPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (err?.code === "OPERATION_FAILED") {
          setShowOperationFailed(true);
          return;
        }
        setResolveError(err?.error || err?.code || "冲突解决失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const items = (status?.items ?? []).filter(
    (item) => item.syncStatus !== "ok" && item.syncStatus !== "committed",
  );
  if (
    !status ||
    (status.syncStatus === "ok" &&
      items.length === 0 &&
      conflicts.length === 0 &&
      !showOperationFailed &&
      !resolveError)
  ) {
    return null;
  }

  return (
    <div
      className="workspace-sync-banner"
      data-testid="workspace-sync-status"
      data-sync-status={status.syncStatus}
    >
      {showOperationFailed ? (
        <RetryableOperationErrorCard
          onRetry={() => void retry()}
          onDismiss={() => setShowOperationFailed(false)}
        />
      ) : null}
      <span>
        {statusLabel({
          syncStatus: status.syncStatus,
          kind: items[0]?.kind ?? "",
          reason: status.syncError,
        })}
        {status.syncError ? `：${status.syncError}` : ""}
      </span>
      {items.map((item) => (
        <div
          key={`${item.kind}:${item.operationId}:${item.scope}`}
          data-testid="workspace-sync-item"
          data-sync-kind={item.kind}
          data-sync-item-status={item.syncStatus}
        >
          <span>
            {statusLabel(item)} · {item.sourceStore} → {item.targetStore} · {item.scope}
            {item.reason ? ` · ${item.reason}` : ""}
          </span>
          {item.kind === "media-metadata-sync" ? (
            <button
              type="button"
              data-testid="workspace-media-metadata-retry"
              disabled={busy}
              onClick={() => void retry(item.retryPath)}
            >
              补齐资产 metadata
            </button>
          ) : item.syncStatus !== "conflict" ? (
            <button
              type="button"
              data-testid="workspace-sync-retry"
              disabled={busy}
              onClick={() => void retry(item.retryPath)}
            >
              重试同步
            </button>
          ) : null}
        </div>
      ))}
      {conflicts.length > 0 ? (
        <div data-testid="workspace-sync-conflicts">
          {conflicts.map((conflict) => {
            const key = `${conflict.entityType}:${conflict.entityId}:${conflict.field}`;
            return (
              <div
                key={key}
                data-testid="workspace-sync-conflict"
                data-entity-type={conflict.entityType}
                data-entity-id={conflict.entityId}
                data-field={conflict.field}
                data-conflict-status={conflict.status ?? "open"}
              >
                <div>
                  {conflict.entityType}/{conflict.entityId} · {conflict.field} · 状态{" "}
                  {conflict.status ?? "open"}
                </div>
                <div data-testid="workspace-sync-conflict-revisions">
                  management rev {conflict.managementRevision} / workspace rev{" "}
                  {conflict.workspaceRevision}
                </div>
                <div data-testid="workspace-sync-conflict-operation">
                  merge {conflict.mergeOperationId ?? conflict.operationId}
                </div>
                <pre data-testid="workspace-sync-conflict-base">
                  base: {formatValue(conflict.baseValue)}
                </pre>
                <pre data-testid="workspace-sync-conflict-management">
                  management: {formatValue(conflict.managementValue)}
                </pre>
                <pre data-testid="workspace-sync-conflict-workspace">
                  workspace: {formatValue(conflict.workspaceValue)}
                </pre>
                <button
                  type="button"
                  data-testid="workspace-sync-conflict-adopt-management"
                  disabled={busy}
                  onClick={() => void resolveConflict(conflict, "management")}
                >
                  采用 management
                </button>
                <button
                  type="button"
                  data-testid="workspace-sync-conflict-adopt-workspace"
                  disabled={busy}
                  onClick={() => void resolveConflict(conflict, "workspace")}
                >
                  采用 workspace
                </button>
                <input
                  data-testid="workspace-sync-conflict-manual-value"
                  value={manualValues[key] ?? ""}
                  onChange={(event) =>
                    setManualValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  placeholder="符合字段 schema 的新值"
                />
                <button
                  type="button"
                  data-testid="workspace-sync-conflict-adopt-manual"
                  disabled={busy}
                  onClick={() => void resolveConflict(conflict, "manual")}
                >
                  采用手动值
                </button>
              </div>
            );
          })}
          {resolveError ? (
            <span data-testid="workspace-sync-conflict-error">{resolveError}</span>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 && conflicts.length === 0 && !showOperationFailed ? (
        <button
          type="button"
          data-testid="workspace-sync-retry"
          disabled={busy}
          onClick={() => void retry()}
        >
          重试同步
        </button>
      ) : null}
    </div>
  );
}
