"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";
import type { ImageGenerationSourceEntry } from "@/projects/assets/image-generation/types";
import {
  IMAGE_JOB_ACTIVE_STATUSES,
  IMAGE_RETRY_SCHEMA_VERSION,
} from "@/projects/assets/image-generation/types";

export type ImageJobPublic = ImageGenerationJob & {
  stageLabel?: string;
  progressLabel?: string;
};

type Context = "management" | "workspace";

export type LibraryImageJobAssetKind =
  | "character"
  | "scene"
  | "prop"
  | "design_item";

function apiRoot(projectId: string, context: Context): string {
  const enc = encodeURIComponent(projectId);
  return context === "workspace"
    ? `/api/workspace/projects/${enc}`
    : `/api/projects/${enc}`;
}

const POLL_MS = 2000;

export function hasUsableRetrySnapshot(
  job: ImageJobPublic | null | undefined,
): boolean {
  const snap = job?.params?.retrySnapshot;
  if (!snap || typeof snap !== "object") return false;
  if (snap.schemaVersion !== IMAGE_RETRY_SCHEMA_VERSION) return false;
  if (snap.mode !== "text_to_image" && snap.mode !== "image_to_image") {
    return false;
  }
  return true;
}

export function useLibraryImageGenerationJob(input: {
  projectId: string;
  context: Context;
  assetId: string;
  assetKind: LibraryImageJobAssetKind;
  enabled?: boolean;
  sourceEntry?: ImageGenerationSourceEntry;
}) {
  const enabled = input.enabled !== false;
  const [job, setJob] = useState<ImageJobPublic | null>(null);
  const [timeoutDialogOpen, setTimeoutDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [serviceNotice, setServiceNotice] = useState("");
  const pollRef = useRef<number | null>(null);
  const extendedOnceRef = useRef(false);
  const seenTerminalRef = useRef<string | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshLatest = useCallback(async () => {
    const params = new URLSearchParams({
      assetId: input.assetId,
      assetKind: input.assetKind,
    });
    if (input.sourceEntry) {
      params.set("sourceEntry", input.sourceEntry);
    }
    const res = await fetch(
      `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs?${params.toString()}`,
      { credentials: "include" },
    );
    const payload = (await res.json().catch(() => ({}))) as {
      job?: ImageJobPublic | null;
    };
    if (res.ok) {
      setJob(payload.job ?? null);
      return payload.job ?? null;
    }
    return null;
  }, [input.assetId, input.assetKind, input.context, input.projectId, input.sourceEntry]);

  const pollJob = useCallback(
    async (jobId: string) => {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(jobId)}`,
        { credentials: "include" },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        job?: ImageJobPublic;
      };
      if (res.ok && payload.job) {
        setJob(payload.job);
        return payload.job;
      }
      return null;
    },
    [input.context, input.projectId],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      stopPoll();
      pollRef.current = window.setInterval(() => {
        void pollJob(jobId).then((next) => {
          if (!next) return;
          if (
            next.status === "succeeded" ||
            next.status === "failed" ||
            next.status === "save_failed"
          ) {
            stopPoll();
          }
          if (
            next.waitDeadlineAt &&
            Date.parse(next.waitDeadlineAt) <= Date.now() &&
            IMAGE_JOB_ACTIVE_STATUSES.includes(next.status)
          ) {
            if (!extendedOnceRef.current) {
              setTimeoutDialogOpen(true);
            } else {
              void fetch(
                `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(jobId)}`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "fail-after-wait" }),
                },
              ).then(() => pollJob(jobId));
            }
          }
        });
      }, POLL_MS);
    },
    [input.context, input.projectId, pollJob, stopPoll],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void refreshLatest().then((latest) => {
      if (cancelled || !latest) return;
      if (IMAGE_JOB_ACTIVE_STATUSES.includes(latest.status)) {
        startPolling(latest.id);
      }
      if (
        (latest.status === "succeeded" || latest.status === "save_failed") &&
        !latest.savedToLibrary &&
        seenTerminalRef.current !== latest.id
      ) {
        seenTerminalRef.current = latest.id;
      }
    });
    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [enabled, refreshLatest, startPolling, stopPoll]);

  const beginFromGenerateResponse = useCallback(
    (payload: { jobId?: string; job?: ImageJobPublic }) => {
      if (payload.job) setJob(payload.job);
      const id = payload.jobId ?? payload.job?.id;
      if (id) {
        extendedOnceRef.current = false;
        setTimeoutDialogOpen(false);
        startPolling(id);
      }
    },
    [startPolling],
  );

  const generationBlocked =
    job != null && IMAGE_JOB_ACTIVE_STATUSES.includes(job.status);

  const continueWaiting = useCallback(async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "extend-wait" }),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        job?: ImageJobPublic;
      };
      if (payload.job) setJob(payload.job);
      extendedOnceRef.current = true;
      setTimeoutDialogOpen(false);
      startPolling(job.id);
    } finally {
      setBusyAction(false);
    }
  }, [input.context, input.projectId, job, startPolling]);

  const markSaved = useCallback(async () => {
    if (!job) return;
    await fetch(
      `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-saved" }),
      },
    );
    await pollJob(job.id);
  }, [input.context, input.projectId, job, pollJob]);

  const markSaveFailed = useCallback(
    async (message: string) => {
      if (!job) return;
      await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "mark-save-failed",
            saveErrorMessage: message,
          }),
        },
      );
      await pollJob(job.id);
    },
    [input.context, input.projectId, job, pollJob],
  );

  const retrySave = useCallback(async () => {
    if (!job) return { ok: false as const, error: "无任务" };
    setBusyAction(true);
    try {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry-save" }),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        job?: ImageJobPublic;
      };
      if (payload.job) setJob(payload.job);
      if (!res.ok) {
        return { ok: false as const, error: payload.error ?? "重新保存失败" };
      }
      return { ok: true as const, job: payload.job ?? null };
    } finally {
      setBusyAction(false);
    }
  }, [input.context, input.projectId, job]);

  const confirmDeletePending = useCallback(async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        job?: ImageJobPublic;
      };
      if (payload.job) setJob(payload.job);
      setDeleteConfirmOpen(false);
    } finally {
      setBusyAction(false);
    }
  }, [input.context, input.projectId, job]);

  const redetectService = useCallback(async () => {
    setBusyAction(true);
    setServiceNotice("");
    try {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/service-status`,
        { credentials: "include" },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        online?: boolean;
        message?: string;
      };
      setServiceNotice(
        payload.message ??
          (payload.online
            ? "图像服务已恢复，可手动重新生成。"
            : "图像服务仍不可用，请稍后再试。"),
      );
    } finally {
      setBusyAction(false);
    }
  }, [input.context, input.projectId]);

  /** Server-side retry from persisted snapshot (survives refresh). */
  const retryFromServer = useCallback(async () => {
    if (!job) return { ok: false as const, error: "无任务" };
    if (!hasUsableRetrySnapshot(job)) {
      return {
        ok: false as const,
        error: "旧任务缺少完整参数，请重新配置生成。",
        code: "RETRY_PAYLOAD_INCOMPLETE",
      };
    }
    setBusyAction(true);
    setServiceNotice("");
    try {
      const res = await fetch(
        `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}/retry`,
        { method: "POST", credentials: "include" },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        jobId?: string;
        job?: ImageJobPublic;
      };
      if (!res.ok) {
        if (payload.job) setJob(payload.job);
        return {
          ok: false as const,
          error: payload.error ?? "重试失败",
          code: payload.code,
        };
      }
      beginFromGenerateResponse(payload);
      return { ok: true as const, job: payload.job ?? null };
    } finally {
      setBusyAction(false);
    }
  }, [beginFromGenerateResponse, input.context, input.projectId, job]);

  const replaceReferences = useCallback(
    async (files: File[]) => {
      if (!job) return { ok: false as const, error: "无任务" };
      setBusyAction(true);
      try {
        const form = new FormData();
        files.forEach((file, index) => {
          form.set(`referenceImage[${index}]`, file);
        });
        const res = await fetch(
          `${apiRoot(input.projectId, input.context)}/assets-draft/media/jobs/${encodeURIComponent(job.id)}/replace-reference`,
          { method: "POST", credentials: "include", body: form },
        );
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          job?: ImageJobPublic;
        };
        if (!res.ok) {
          return {
            ok: false as const,
            error: payload.error ?? "替换参考图失败",
            code: payload.code,
          };
        }
        if (payload.job) setJob(payload.job);
        return { ok: true as const, job: payload.job ?? null };
      } finally {
        setBusyAction(false);
      }
    },
    [input.context, input.projectId, job],
  );

  const snapshotUsable = hasUsableRetrySnapshot(job);
  const canRetry =
    job != null &&
    job.status === "failed" &&
    snapshotUsable &&
    job.errorCode !== "INVALID_PARAMS" &&
    job.errorCode !== "REFERENCE_IMAGE_REQUIRED";

  const needsReferenceReplace =
    job != null &&
    job.status === "failed" &&
    (job.errorCode === "REFERENCE_IMAGE_REQUIRED" ||
      (snapshotUsable &&
        job.params.retrySnapshot?.mode === "image_to_image" &&
        (job.params.retrySnapshot.referenceStorageKeys?.length ?? 0) === 0 &&
        (job.params.retrySnapshot.libraryReferenceMediaIds?.length ?? 0) ===
          0));

  const retrySnapshotIncomplete =
    job != null &&
    job.status === "failed" &&
    !snapshotUsable &&
    job.errorCode !== "INVALID_PARAMS";

  return {
    job,
    generationBlocked,
    timeoutDialogOpen,
    setTimeoutDialogOpen,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    busyAction,
    serviceNotice,
    setServiceNotice,
    beginFromGenerateResponse,
    continueWaiting,
    markSaved,
    markSaveFailed,
    retrySave,
    confirmDeletePending,
    redetectService,
    retryFromServer,
    replaceReferences,
    canRetry,
    needsReferenceReplace,
    retrySnapshotIncomplete,
    refreshLatest,
    stopPoll,
  };
}
