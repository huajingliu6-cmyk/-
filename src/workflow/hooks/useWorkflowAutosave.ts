"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowDocument } from "../types";
import { migrateWorkflowDocument } from "../migrate";
import { sanitizeWorkflowForPersist } from "../lib/sanitize-workflow";
import { useWorkflowStore } from "../store";

const AUTOSAVE_MS = 400;
export function useWorkflowAutosave(projectId: string) {
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const saveEpoch = useWorkflowStore((s) => s.saveEpoch);
  const contentEpoch = useWorkflowStore((s) => s.contentEpoch);
  const setDocument = useWorkflowStore((s) => s.setDocument);
  const acknowledgeSave = useWorkflowStore((s) => s.acknowledgeSave);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const setLoadError = useWorkflowStore((s) => s.setLoadError);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const loadedRef = useRef(false);
  const lastHandledEpochRef = useRef(0);
  const [backupBanner, setBackupBanner] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const persist = useCallback(
    async (doc: WorkflowDocument) => {
      const requestId = ++requestIdRef.current;
      setSaveStatus("saving");
      const sanitized = sanitizeWorkflowForPersist(doc);
      const putOnce = async () => {
        const res = await fetch(
          `/api/workflow?projectId=${encodeURIComponent(projectId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sanitized),
          },
        );
        const payload = (await res.json()) as WorkflowDocument & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error ?? "保存失败");
        }
        return payload;
      };

      try {
        let payload: WorkflowDocument;
        try {
          payload = await putOnce();
        } catch {
          // 页面刚从后台恢复时，开发服/瞬时网络常失败一次；静默重试避免红字闪一下
          await new Promise((r) => window.setTimeout(r, 450));
          if (requestId !== requestIdRef.current) return;
          payload = await putOnce();
        }

        if (requestId !== requestIdRef.current) return;

        const saved = migrateWorkflowDocument(payload);
        acknowledgeSave(saved.revision, saved.updatedAt);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const message =
          error instanceof Error ? error.message : "保存失败，请稍后重试";
        setSaveStatus("error", message);
      }
    },
    [projectId, acknowledgeSave, setSaveStatus],
  );

  const saveNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist(useWorkflowStore.getState().document);
  }, [persist]);

  useEffect(() => {
    // 同项目 store 已有数据时跳过：StrictMode/桥接重挂载不得再 set loading 闪屏
    // loadNonce>0 表示用户主动重试，必须重新请求
    if (loadNonce === 0) {
      const snap = useWorkflowStore.getState();
      if (
        snap.projectId === projectId &&
        snap.saveStatus !== "loading" &&
        (snap.saveStatus === "loaded" ||
          snap.saveStatus === "saved" ||
          snap.saveStatus === "dirty" ||
          snap.saveStatus === "error") &&
        !snap.loadError
      ) {
        loadedRef.current = true;
        lastHandledEpochRef.current = snap.saveEpoch;
        return;
      }
    }

    let cancelled = false;
    loadedRef.current = false;
    setSaveStatus("loading");
    setLoadError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/workflow?projectId=${encodeURIComponent(projectId)}`,
        );
        const payload = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          throw new Error(payload.error ?? "加载失败");
        }

        const doc = migrateWorkflowDocument(payload);
        setDocument(doc, "loaded");
        loadedRef.current = true;
        lastHandledEpochRef.current = useWorkflowStore.getState().saveEpoch;
        setBackupBanner(null);
      } catch (error) {
        if (cancelled) return;
        setBackupBanner(null);
        const message =
          error instanceof Error ? error.message : "加载工作流失败";
        setLoadError(message);
        setSaveStatus("error", message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, loadNonce, setDocument, setSaveStatus, setLoadError]);

  // contentEpoch：内容变更防抖保存；视口平移不递增
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveStatus !== "dirty") return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist(useWorkflowStore.getState().document);
    }, AUTOSAVE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [contentEpoch, saveStatus, persist]);

  // saveEpoch：结构性操作立即保存
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveEpoch === 0) return;
    if (saveEpoch === lastHandledEpochRef.current) return;
    lastHandledEpochRef.current = saveEpoch;
    queueMicrotask(() => {
      saveNow();
    });
  }, [saveEpoch, saveNow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (!isSave) return;
      event.preventDefault();
      saveNow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow]);

  useEffect(() => {
    if (saveStatus !== "dirty") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);

  const reloadFromServer = useCallback(() => {
    setBackupBanner(null);
    setLoadNonce((n) => n + 1);
  }, []);

  const dismissBackupBanner = useCallback(() => {
    setBackupBanner(null);
  }, []);

  return {
    saveNow,
    backupBanner,
    reloadFromServer,
    dismissBackupBanner,
  };
}
