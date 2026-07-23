"use client";

import { useCallback, useEffect, useRef } from "react";
import type { WorkflowDocument } from "../types";
import { migrateWorkflowDocument } from "../migrate";
import { sanitizeWorkflowForPersist } from "../lib/sanitize-workflow";
import { useWorkflowStore } from "../store";

const AUTOSAVE_MS = 900;
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
  const setDocument = useWorkflowStore((s) => s.setDocument);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const setLoadError = useWorkflowStore((s) => s.setLoadError);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const loadedRef = useRef(false);

  const persist = useCallback(
    async (doc: WorkflowDocument) => {
      const requestId = ++requestIdRef.current;
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
        setDocument(saved, "saved");
        writeLocalBackup(saved);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const message =
          error instanceof Error ? error.message : "保存失败，请稍后重试";
        setSaveStatus("error", message);
      }
    },
    [projectId, setDocument, setSaveStatus],
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
      } catch (error) {
        if (cancelled) return;
        const backup = readLocalBackup(projectId);
        if (backup) {
          setDocument(backup, "loaded");
          loadedRef.current = true;
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

  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveStatus !== "dirty") return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist(document);
    }, AUTOSAVE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [document, saveStatus, persist]);

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
