"use client";

import { useCallback, useEffect, useRef } from "react";
import type { WorkflowDocument } from "../types";
import { migrateWorkflowDocument } from "../migrate";
import { sanitizeWorkflowForPersist } from "../lib/sanitize-workflow";
import { useWorkflowStore } from "../store";

/** 文字编辑等常规 dirty：停顿后保存 */
const AUTOSAVE_MS = 400;

const BACKUP_PREFIX = "workflow-backup:";

function backupKey(projectId: string) {
  return `${BACKUP_PREFIX}${projectId}`;
}

export function writeLocalBackup(doc: WorkflowDocument) {
  try {
    localStorage.setItem(backupKey(doc.projectId), JSON.stringify(doc));
  } catch {
    // quota / private mode：忽略
  }
}

export function readLocalBackup(
  projectId: string,
): WorkflowDocument | null {
  try {
    const raw = localStorage.getItem(backupKey(projectId));
    if (!raw) return null;
    return migrateWorkflowDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function useWorkflowAutosave(projectId: string) {
  const document = useWorkflowStore((s) => s.document);
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const saveEpoch = useWorkflowStore((s) => s.saveEpoch);
  const setDocument = useWorkflowStore((s) => s.setDocument);
  const acknowledgeSave = useWorkflowStore((s) => s.acknowledgeSave);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const setLoadError = useWorkflowStore((s) => s.setLoadError);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const loadedRef = useRef(false);
  const lastHandledEpochRef = useRef(0);
  /** 发起保存时的 revision，用于避免用旧响应覆盖更新中的文档 */
  const savingRevisionRef = useRef<number | null>(null);

  const persist = useCallback(
    async (doc: WorkflowDocument) => {
      const requestId = ++requestIdRef.current;
      savingRevisionRef.current = doc.revision;
      setSaveStatus("saving");
      const sanitized = sanitizeWorkflowForPersist(doc);
      writeLocalBackup(sanitized);

      try {
        const res = await fetch(
          `/api/workflow?projectId=${encodeURIComponent(projectId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sanitized),
          },
        );

        const payload = await res.json();
        if (requestId !== requestIdRef.current) return;

        if (!res.ok) {
          throw new Error(payload.error ?? "保存失败");
        }

        const saved = migrateWorkflowDocument(payload);
        // 不整表 setDocument，避免上传后画布闪烁
        acknowledgeSave(saved.revision, saved.updatedAt);
        writeLocalBackup({
          ...useWorkflowStore.getState().document,
          revision: saved.revision,
          updatedAt: saved.updatedAt,
        });
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const message =
          error instanceof Error ? error.message : "保存失败，请稍后重试";
        setSaveStatus("error", message);
      } finally {
        savingRevisionRef.current = null;
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
        writeLocalBackup(doc);
        loadedRef.current = true;
        lastHandledEpochRef.current = useWorkflowStore.getState().saveEpoch;
      } catch (error) {
        if (cancelled) return;
        const backup = readLocalBackup(projectId);
        if (backup) {
          setDocument(backup, "loaded");
          loadedRef.current = true;
          lastHandledEpochRef.current = useWorkflowStore.getState().saveEpoch;
          setSaveStatus(
            "error",
            "服务器加载失败，已使用本地备份（可能不是最新）",
          );
          return;
        }
        const message =
          error instanceof Error ? error.message : "加载工作流失败";
        setLoadError(message);
        setSaveStatus("error", message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, setDocument, setSaveStatus, setLoadError]);

  /** 文字编辑等：dirty 后短暂停顿再保存 */
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
  }, [document, saveStatus, persist]);

  /** 生成完成 / 上传素材 / 移动节点等：立即保存 */
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveEpoch === 0) return;
    if (saveEpoch === lastHandledEpochRef.current) return;
    lastHandledEpochRef.current = saveEpoch;
    // 微任务：确保同一 tick 内的 store 更新已合并后再读取 document
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

  return { saveNow };
}
