"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmLeaveDialog } from "@/shell/ConfirmLeaveDialog";
import {
  beginGenerationBusy,
  bindGenerationBusyUi,
  getGenerationBusySummary,
  isGenerationBusy,
  subscribeGenerationBusy,
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

/** 在生成生命周期内登记全局忙碌；结束后自动注销 */
export function useGenerationBusy(
  active: boolean,
  id: string,
  label: string,
): void {
  useEffect(() => {
    if (!active) return;
    return beginGenerationBusy(id, label);
  }, [active, id, label]);
}

/**
 * 壳层挂载：beforeunload + 拦截弹层（仅「留在此页」，不允许强行离开打断进度）。
 */
export function GenerationBusyGuard() {
  const busy = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const resolveRef = useRef<((value: false) => void) | null>(null);

  useEffect(() => {
    bindGenerationBusyUi({
      showBlocked: () =>
        new Promise<false>((resolve) => {
          setSummary(getGenerationBusySummary());
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
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  const close = () => {
    setOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  };

  return (
    <ConfirmLeaveDialog
      open={open}
      title="生成进行中，无法离开"
      description={
        summary
          ? `当前正在进行「${summary}」。请等待完成，或先在本页取消生成后再进行其他操作。离开或切换页面会中断进度。`
          : "当前有生成任务进行中。请等待完成，或先在本页取消生成后再进行其他操作。"
      }
      acknowledgeOnly
      cancelLabel="留在此页"
      onConfirm={close}
      onCancel={close}
    />
  );
}
