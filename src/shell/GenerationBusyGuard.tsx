"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ConfirmLeaveDialog } from "@/shell/ConfirmLeaveDialog";
import {
  ASSET_EXTRACTION_NAV_BLOCK_MESSAGE,
  ASSET_EXTRACTION_STAGE_LABELS,
  isAwaitingRosterSelectionStatus,
  isBlockingExtractionStatus,
  type AssetExtractionProgress,
  type AssetExtractionProgressPhase,
  type AssetExtractionStage,
  type PublicAssetExtractionTask,
} from "@/projects/assets/extraction/types";
import {
  footerLinesForProgress,
  subtitleForProgressPhase,
} from "@/projects/assets/extraction/progress-view";
import {
  beginGenerationBusy,
  bindGenerationBusyUi,
  getAssetExtractionBusyOverlay,
  getGenerationBusySummary,
  isGenerationBusy,
  listGenerationBusyEntries,
  subscribeGenerationBusy,
  updateGenerationBusy,
} from "@/shell/generation-busy";

function subscribe(onStoreChange: () => void) {
  return subscribeGenerationBusy(onStoreChange);
}

function getSnapshot() {
  return isGenerationBusy();
}

function getServerSnapshot() {
  return false;
}

export function useGenerationBusy(
  active: boolean,
  id: string,
  label: string,
  options?: Parameters<typeof beginGenerationBusy>[2],
): void {
  const optionsKey = JSON.stringify(options ?? {});
  useEffect(() => {
    if (!active) return;
    return beginGenerationBusy(id, label, options);
    // optionsKey tracks overlay/project changes without identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id, label, optionsKey]);
}

function projectContextFromPath(pathname: string): {
  projectId: string;
  apiRoot: string;
} | null {
  const workspace = pathname.match(/^\/app\/workspace\/projects\/([^/]+)/);
  if (workspace?.[1]) {
    const projectId = decodeURIComponent(workspace[1]);
    return {
      projectId,
      apiRoot: `/api/workspace/projects/${encodeURIComponent(projectId)}`,
    };
  }
  const management = pathname.match(/^\/app\/projects\/([^/]+)/);
  if (management?.[1]) {
    const projectId = decodeURIComponent(management[1]);
    return {
      projectId,
      apiRoot: `/api/projects/${encodeURIComponent(projectId)}`,
    };
  }
  return null;
}

type StepState = "completed" | "active" | "pending";

type OverlayStep = {
  id: string;
  label: string;
  state: StepState;
};

function stepsForPhase(phase: AssetExtractionProgressPhase): OverlayStep[] {
  const order: AssetExtractionProgressPhase[] = [
    "discovering_roster",
    "merging_roster",
    "extracting_details",
    "saving",
  ];
  const labels = ["扫描剧本", "整理名单", "提取详情", "保存结果"];
  const activeIndex =
    phase === "completed"
      ? 4
      : phase === "retrying_failed_once"
        ? 2
        : order.indexOf(phase);
  return labels.map((label, index) => {
    const stepLabel =
      index === 2 && phase === "retrying_failed_once" ? "补全详情" : label;
    let state: StepState = "pending";
    if (phase === "completed" || index < activeIndex) state = "completed";
    else if (index === activeIndex) state = "active";
    return {
      id: `step-${index + 1}`,
      label: stepLabel,
      state,
    };
  });
}

function formatStatBlocks(progress: AssetExtractionProgress): Array<{
  label: string;
  value: string;
}> {
  const { phase, roster, details } = progress;
  if (phase === "discovering_roster" || phase === "merging_roster") {
    return [
      {
        label: "已扫描剧本",
        value: `${roster.scannedChunks} / ${Math.max(1, roster.totalChunks)} 段`,
      },
      {
        label: "已发现资产",
        value: String(roster.discoveredCount),
      },
      {
        label: "当前处理",
        value: phase === "merging_roster" ? "正在整理名单" : "扫描分块中",
      },
    ];
  }

  const batchValue =
    details.totalBatches > 0
      ? `第 ${Math.min(
          Math.max(details.completedBatches + (details.runningBatches > 0 ? 1 : 0), 1),
          details.totalBatches,
        )} / ${details.totalBatches} 批`
      : "准备批次";

  return [
    {
      label: "已发现资产",
      value: String(Math.max(roster.discoveredCount, details.totalAssets)),
    },
    {
      label: "已完成详情",
      value: `${details.completedAssets} / ${Math.max(details.totalAssets, 0)}`,
    },
    {
      label: "当前处理",
      value:
        details.runningBatches > 1
          ? `${batchValue} · ${details.runningBatches} 路并行`
          : batchValue,
    },
  ];
}

function ExtractionOverlayCard({
  overlay,
  apiRoot,
  onRecover,
  onCancel,
}: {
  overlay: NonNullable<ReturnType<typeof getAssetExtractionBusyOverlay>>;
  apiRoot: string | null;
  onRecover: () => void;
  onCancel: () => void;
}) {
  const progress = overlay.progress;
  const recovering = Boolean(overlay.runnerStale);
  const phase: AssetExtractionProgressPhase =
    progress?.phase ??
    (overlay.stage === "complete"
      ? "completed"
      : (overlay.stage as AssetExtractionProgressPhase));
  const percent = Math.max(
    0,
    Math.min(100, progress?.estimatedProgress ?? overlay.estimatedProgress),
  );
  const subtitle = recovering
    ? "提取任务正在恢复，请稍候"
    : subtitleForProgressPhase(phase);
  const steps = stepsForPhase(phase);
  const stats = progress
    ? formatStatBlocks(progress)
    : [
        { label: "已发现资产", value: "—" },
        { label: "已完成详情", value: "—" },
        { label: "当前处理", value: overlay.stageLabel },
      ];
  const footers = recovering
    ? ["检测到提取进程中断，正在尝试恢复原任务", "请稍候，进度不会重置"]
    : progress
      ? footerLinesForProgress(progress)
      : ["结果会在完成后自动进入资产页"];

  return (
    <div
      className="generation-busy-overlay"
      data-testid="asset-extraction-overlay"
      data-runner-stale={recovering ? "true" : "false"}
      role="status"
      aria-live="polite"
    >
      <div className="generation-busy-overlay__card generation-busy-overlay__card--extraction">
        <header className="generation-busy-overlay__header">
          <strong>{recovering ? "提取任务正在恢复" : "正在提取资产"}</strong>
          <p data-testid="asset-extraction-overlay-stage">{subtitle}</p>
        </header>

        <ol
          className="generation-busy-overlay__steps"
          data-testid="asset-extraction-overlay-steps"
        >
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`generation-busy-overlay__step generation-busy-overlay__step--${step.state}`}
              data-state={step.state}
            >
              <span className="generation-busy-overlay__step-index" aria-hidden>
                {step.state === "completed" ? "✓" : index + 1}
              </span>
              <span className="generation-busy-overlay__step-label">{step.label}</span>
              {index < steps.length - 1 ? (
                <span className="generation-busy-overlay__step-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <div
          className="generation-busy-overlay__stats"
          data-testid="asset-extraction-overlay-stats"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="generation-busy-overlay__stat">
              <span className="generation-busy-overlay__stat-label">{stat.label}</span>
              <span className="generation-busy-overlay__stat-value">{stat.value}</span>
            </div>
          ))}
        </div>

        <div
          className="generation-busy-overlay__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span data-testid="asset-extraction-overlay-percent">
            预计进度 {percent}%
          </span>
          <span className="generation-busy-overlay__track" aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </span>
        </div>

        {recovering && apiRoot && overlay.taskId ? (
          <div
            className="generation-busy-overlay__actions"
            data-testid="asset-extraction-overlay-recover-actions"
          >
            <button type="button" onClick={onRecover}>
              恢复任务
            </button>
            <button type="button" onClick={onCancel}>
              取消任务
            </button>
          </div>
        ) : null}

        <footer className="generation-busy-overlay__footer">
          {footers.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </footer>
      </div>
    </div>
  );
}

/**
 * 壳层挂载：beforeunload + 拦截弹层 + 资产提取全屏任务卡。
 */
export function GenerationBusyGuard() {
  const pathname = usePathname();
  const busy = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const overlay = useSyncExternalStore(
    subscribe,
    getAssetExtractionBusyOverlay,
    () => null,
  );
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const resolveRef = useRef<((value: false) => void) | null>(null);
  const projectCtx = projectContextFromPath(pathname);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    bindGenerationBusyUi({
      showBlocked: (message) =>
        new Promise<false>((resolve) => {
          setSummary(
            message ||
              (getGenerationBusySummary()
                ? `当前正在进行「${getGenerationBusySummary()}」。`
                : ASSET_EXTRACTION_NAV_BLOCK_MESSAGE),
          );
          resolveRef.current = resolve;
          setOpen(true);
        }),
    });
    return () => {
      bindGenerationBusyUi(null);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const onlyExtraction = listGenerationBusyEntries().every(
      (entry) => entry.kind === "asset-extraction",
    );
    if (onlyExtraction) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  useEffect(() => {
    const ctx = projectContextFromPath(pathname);
    if (!ctx) {
      pollRef.current = null;
      return;
    }
    const busyId = `asset-extraction-${ctx.projectId}`;
    let cancelled = false;
    let endBusy: (() => void) | null = null;

    const applyTask = (task: PublicAssetExtractionTask | null) => {
      if (cancelled) return;
      if (!task || !isBlockingExtractionStatus(task.status)) {
        endBusy?.();
        endBusy = null;
        return;
      }
      const awaiting = isAwaitingRosterSelectionStatus(task.status);
      const stage = (awaiting ? "merging_roster" : task.stage) as AssetExtractionStage;
      const progress = task.progress;
      const nextOverlay = {
        stage: awaiting ? "merging_roster" : task.stage,
        stageLabel: awaiting
          ? "请选择要设计的资产"
          : task.runnerStale
            ? "提取任务正在恢复"
            : ASSET_EXTRACTION_STAGE_LABELS[stage],
        estimatedProgress: awaiting
          ? Math.min(15, progress?.estimatedProgress ?? task.estimatedProgress)
          : Math.min(
              99,
              progress?.estimatedProgress ?? task.estimatedProgress,
            ),
        errorMessage: task.errorMessage,
        runnerStale: Boolean(task.runnerStale) && !awaiting,
        taskId: task.id,
        progress: awaiting
          ? {
              ...(progress ?? {
                phase: "awaiting_roster_selection" as const,
                estimatedProgress: 15,
                roster: {
                  scannedChunks: 1,
                  totalChunks: 1,
                  discoveredCount: task.roster?.length ?? 0,
                },
                details: {
                  totalAssets: 0,
                  completedAssets: 0,
                  runningBatches: 0,
                  completedBatches: 0,
                  totalBatches: 0,
                  retryRound: 0 as const,
                },
              }),
              phase: "awaiting_roster_selection" as const,
            }
          : progress,
      };
      if (!endBusy) {
        endBusy = beginGenerationBusy(busyId, "资产提取", {
          projectId: ctx.projectId,
          kind: "asset-extraction",
          overlay: nextOverlay,
          leaveMessage: ASSET_EXTRACTION_NAV_BLOCK_MESSAGE,
        });
      } else {
        updateGenerationBusy(busyId, { overlay: nextOverlay });
      }
    };

    const tick = async () => {
      try {
        const res = await fetch(`${ctx.apiRoot}/asset-extraction`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          task?: PublicAssetExtractionTask | null;
        };
        applyTask(payload.task ?? null);
      } catch {
        /* ignore poll errors */
      }
    };
    pollRef.current = tick;

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      pollRef.current = null;
      window.clearInterval(timer);
      endBusy?.();
    };
  }, [pathname]);

  const close = () => {
    setOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  };

  const handleRecover = () => {
    void pollRef.current?.();
  };

  const handleCancel = () => {
    const taskId = overlay?.taskId;
    const ctx = projectCtx;
    if (!taskId || !ctx) return;
    void (async () => {
      try {
        await fetch(
          `${ctx.apiRoot}/asset-extraction/tasks/${encodeURIComponent(taskId)}/cancel`,
          { method: "POST", credentials: "include" },
        );
      } catch {
        /* ignore */
      }
      void pollRef.current?.();
    })();
  };

  return (
    <>
      {overlay ? (
        <ExtractionOverlayCard
          overlay={overlay}
          apiRoot={projectCtx?.apiRoot ?? null}
          onRecover={handleRecover}
          onCancel={handleCancel}
        />
      ) : null}
      <ConfirmLeaveDialog
        open={open}
        title="无法离开"
        description={
          summary.includes("资产提取尚未完成")
            ? ASSET_EXTRACTION_NAV_BLOCK_MESSAGE
            : summary || ASSET_EXTRACTION_NAV_BLOCK_MESSAGE
        }
        acknowledgeOnly
        cancelLabel="留在此页"
        onConfirm={close}
        onCancel={close}
      />
    </>
  );
}
