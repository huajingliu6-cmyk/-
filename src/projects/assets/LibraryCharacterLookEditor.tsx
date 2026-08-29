"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetImageEditPanel,
  DEFAULT_DESIGN_IMAGE_MODEL_ID,
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  emptyAssetImageEditSlots,
  revokeAssetImageEditSlots,
  type AssetImageEditReferenceSlot,
} from "@/projects/assets/AssetImageEditPanel";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import type { DesignImageGenerationOptions } from "@/projects/assets/episode-design/image-generation-options";
import { DESIGN_IMAGE_QUALITY_LABELS } from "@/projects/assets/episode-design/image-generation-options";
import type { DesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import { DESIGN_IMAGE_MODELS } from "@/projects/assets/episode-design/image-generation-models";
import { postLibrarySd2Precheck } from "@/projects/assets/post-library-sd2-precheck";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import type { CharacterAsset } from "@/projects/assets/types";
import { safeRandomUUID } from "@/lib/safe-random-id";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";
import { useLibraryImageGenerationJob } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { IMAGE_JOB_ACTIVE_STATUSES } from "@/projects/assets/image-generation/types";
import {
  progressForResumedLibraryLookJob,
  shouldResumeLibraryLookJob,
} from "@/projects/assets/character-look-job-resume";
import { ImageGenerationTaskPanel } from "@/projects/assets/image-generation/ImageGenerationTaskPanel";
import type { AssetGenerationProgress } from "@/projects/assets/DesignGenerationOverlay";
import {
  MaterialPickerModal,
  type MaterialPickerSelection,
} from "@/materials/ui/MaterialPickerModal";
import type { MaterialType } from "@/materials/types";

export type CharacterLookSaveResult = {
  mediaId: string;
  character: CharacterAsset;
  appearanceId?: string | null;
};

type Props = {
  projectId: string;
  context: "management" | "workspace";
  characterId: string;
  characterName: string;
  /**
   * Character main/primary media — always used to seed reference slot 1.
   * Must not be a look-only media id.
   */
  primaryMediaId: string | null;
  /** @deprecated Prefer primaryMediaId; kept for call-site compatibility. */
  initialMediaId?: string | null;
  existingMediaIds: string[];
  /** When set, generation results append to this appearance history only. */
  appearanceId?: string | null;
  initialPrompt?: string;
  initialLookName?: string;
  onClose: () => void;
  /** Parent should merge character data without remounting/closing the editor. */
  onSaved: (result: CharacterLookSaveResult) => void;
};

function makeInitialSlots(
  projectId: string,
  primaryMediaId: string | null,
  context: "management" | "workspace",
): AssetImageEditReferenceSlot[] {
  const slots = emptyAssetImageEditSlots();
  if (primaryMediaId) {
    slots[0] = {
      source: "asset-media",
      mediaId: primaryMediaId,
      previewUrl: getProjectAssetImageUrl(projectId, primaryMediaId, {
        revision: primaryMediaId,
        context,
      }),
    };
  }
  return slots;
}

function appendHistoryIds(
  previous: string[],
  mediaIds: string[],
): string[] {
  const next = [...previous];
  for (const mediaId of mediaIds) {
    if (!next.includes(mediaId)) next.push(mediaId);
  }
  return next;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export function LibraryCharacterLookEditor({
  projectId,
  context,
  characterId,
  characterName,
  primaryMediaId = null,
  initialMediaId = null,
  existingMediaIds,
  appearanceId = null,
  initialPrompt = "",
  initialLookName = "",
  onClose,
  onSaved,
}: Props) {
  // primaryMediaId seeds reference slot 1 only — never the left preview.
  const slotPrimaryMediaId = primaryMediaId ?? initialMediaId;
  // Freeze "new look" for this editor session so linking an appearance after
  // first generate does not suddenly reveal history UI.
  const [openedAsNewLook] = useState(() => !appearanceId);
  const historyEnabled = !openedAsNewLook;
  // currentLookMediaId: left preview; independent from reference slots / primary.
  const [currentLookMediaId, setCurrentLookMediaId] = useState<string | null>(
    null,
  );
  const [lookHistoryIds, setLookHistoryIds] = useState<string[]>(() =>
    openedAsNewLook ? [] : existingMediaIds,
  );
  const [showHistory, setShowHistory] = useState(
    !openedAsNewLook && existingMediaIds.length > 0,
  );
  const [referenceSlots, setReferenceSlots] = useState<
    AssetImageEditReferenceSlot[]
  >(() => makeInitialSlots(projectId, slotPrimaryMediaId, context));
  const [prompt, setPrompt] = useState(initialPrompt);
  const [lookName, setLookName] = useState(initialLookName);
  const [boundAppearanceId, setBoundAppearanceId] = useState<string | null>(
    appearanceId,
  );
  const [imageOptions, setImageOptions] = useState<DesignImageGenerationOptions>(
    () => ({ ...DEFAULT_DESIGN_IMAGE_OPTIONS, aspectRatio: "16:9" }),
  );
  const [imageModelId, setImageModelId] = useState<DesignImageModelId>(
    DEFAULT_DESIGN_IMAGE_MODEL_ID,
  );
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generationProgress, setGenerationProgress] =
    useState<AssetGenerationProgress | null>(null);
  const [validating, setValidating] = useState(false);
  const [certifiedMediaIds, setCertifiedMediaIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    prompt?: boolean;
    referenceImages?: boolean;
  }>({});
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [pendingPersonalUpload, setPendingPersonalUpload] = useState<{
    slotIndex: number;
    file: File;
    previewUrl: string;
  } | null>(null);
  const [saveToPersonal, setSaveToPersonal] = useState(false);
  const [personalSaveBusy, setPersonalSaveBusy] = useState(false);
  const [personalMeta, setPersonalMeta] = useState<{
    name: string;
    type: MaterialType;
    description: string;
    tags: string;
  }>({ name: "", type: "clothing", description: "", tags: "" });
  const referenceSlotsRef = useRef(referenceSlots);
  const generateInFlightRef = useRef(false);
  const appliedJobIdRef = useRef<string | null>(null);
  /** Only apply job results started from this editor session (ignore refreshLatest stale jobs). */
  const acceptJobResultsRef = useRef(false);
  const ownedJobIdsRef = useRef<Set<string>>(new Set());
  const lastErrorKeyRef = useRef<string | null>(null);
  const committedLookNameRef = useRef(initialLookName.trim());
  const progressClearTimerRef = useRef<number | null>(null);

  const claimJobForSession = useCallback((jobId?: string | null) => {
    acceptJobResultsRef.current = true;
    if (jobId) ownedJobIdsRef.current.add(jobId);
  }, []);

  const imageJob = useLibraryImageGenerationJob({
    projectId,
    context,
    assetId: characterId,
    assetKind: "character",
    sourceEntry: "library_look",
  });

  const clearProgressLater = useCallback((delayMs: number) => {
    if (progressClearTimerRef.current != null) {
      window.clearTimeout(progressClearTimerRef.current);
    }
    progressClearTimerRef.current = window.setTimeout(() => {
      progressClearTimerRef.current = null;
      setGenerationProgress(null);
    }, delayMs);
  }, []);

  const reportErrorOnce = useCallback((message: string) => {
    const key = message.trim();
    if (!key) return;
    if (lastErrorKeyRef.current === key) return;
    lastErrorKeyRef.current = key;
    setError(key);
  }, []);

  useEffect(() => {
    return () => {
      if (progressClearTimerRef.current != null) {
        window.clearTimeout(progressClearTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setBoundAppearanceId(appearanceId);
  }, [appearanceId]);

  useEffect(() => {
    if (!appearanceId) return;
    const trimmed = initialLookName.trim();
    if (!trimmed) return;
    setLookName(initialLookName);
    committedLookNameRef.current = trimmed;
  }, [appearanceId, initialLookName]);

  const persistGeneratedMedia = useCallback(
    async (mediaId: string, jobId?: string | null) => {
      const activeAppearanceId = boundAppearanceId;
      if (activeAppearanceId) {
        const response = await fetch(
          `${
            context === "workspace"
              ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
              : `/api/projects/${encodeURIComponent(projectId)}`
          }/assets-draft/characters/${encodeURIComponent(characterId)}/media`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "append-appearance-media",
              mediaId,
              appearanceId: activeAppearanceId,
              ...(jobId ? { jobId } : {}),
            }),
          },
        );
        const payload = await parseResponseJson<{
          error?: string;
          character?: CharacterAsset;
          appearance?: { id: string };
        }>(response);
        if (!payload || !response.ok || !payload.character) {
          throw new Error(payload?.error ?? "保存造型结果失败");
        }
        onSaved({
          mediaId,
          character: payload.character,
          appearanceId: payload.appearance?.id ?? activeAppearanceId,
        });
        return;
      }

      const name = lookName.trim() || `${characterName}造型`;
      const response = await fetch(
        `${
          context === "workspace"
            ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
            : `/api/projects/${encodeURIComponent(projectId)}`
        }/assets-draft/characters/${encodeURIComponent(characterId)}/media`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add-look",
            mediaId,
            displayName: name,
            promptOverride: prompt.trim(),
            ...(jobId ? { jobId } : {}),
          }),
        },
      );
      const payload = await parseResponseJson<{
        error?: string;
        code?: string;
        character?: CharacterAsset;
        appearance?: { id: string };
      }>(response);
      if (!payload || !response.ok || !payload.character) {
        // Generated blob is already on disk; keep preview. Soft-fail only for
        // provenance / unexpected 422 — SD2 is no longer required for add-look.
        if (payload?.code === "LOOK_PROVENANCE_REQUIRED" || response.status === 422) {
          setNotice(
            payload?.error ??
              "造型图已生成，但写入造型库失败；可完成人物校验后重试保存。",
          );
          return;
        }
        throw new Error(payload?.error ?? "保存造型结果失败");
      }
      if (payload.appearance?.id) {
        setBoundAppearanceId(payload.appearance.id);
        committedLookNameRef.current = name;
      }
      onSaved({
        mediaId,
        character: payload.character,
        appearanceId: payload.appearance?.id ?? null,
      });
    },
    [
      boundAppearanceId,
      characterId,
      characterName,
      context,
      lookName,
      onSaved,
      projectId,
      prompt,
    ],
  );

  const applyGeneratedResult = useCallback(
    async (mediaIds: string[], jobId?: string | null) => {
      if (mediaIds.length === 0) return;
      const primary = mediaIds[0]!;
      // Never put character primary into look history; only generated look media.
      const lookOnlyIds = mediaIds.filter((id) => id !== slotPrimaryMediaId);
      setLookHistoryIds((previous) =>
        appendHistoryIds(previous, lookOnlyIds.length > 0 ? lookOnlyIds : mediaIds),
      );
      // New-look editor never surfaces history UI.
      if (historyEnabled) {
        setShowHistory(true);
      }
      setCurrentLookMediaId(primary);
      setGenerationProgress({
        stage: "saving",
        percent: 88,
        message: "正在保存图片",
      });
      await nextFrame();
      try {
        await persistGeneratedMedia(primary, jobId);
        await imageJob.markSaved();
        setNotice(
          openedAsNewLook
            ? "造型已生成并写入造型库。"
            : "造型已生成并写入当前造型历史。",
        );
      } catch (caught) {
        reportErrorOnce(
          caught instanceof Error ? caught.message : "保存造型结果失败",
        );
      }
      setGenerationProgress({
        stage: "completed",
        percent: 100,
        message: "图片生成完成",
      });
      clearProgressLater(900);
      setGenerateBusy(false);
    },
    [
      clearProgressLater,
      historyEnabled,
      imageJob,
      openedAsNewLook,
      persistGeneratedMedia,
      reportErrorOnce,
      slotPrimaryMediaId,
    ],
  );

  useEffect(() => {
    const job = imageJob.job;
    if (
      !shouldResumeLibraryLookJob(job, {
        ownedJobIds: ownedJobIdsRef.current,
        appliedJobId: appliedJobIdRef.current,
      })
    ) {
      return;
    }
    claimJobForSession(job.id);
    if (IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) {
      setGenerateBusy(true);
      setGenerationProgress(progressForResumedLibraryLookJob(job));
    }
  }, [claimJobForSession, imageJob.job]);

  useEffect(() => {
    const job = imageJob.job;
    if (!job) return;
    if (!ownedJobIdsRef.current.has(job.id)) {
      if (
        job.status === "succeeded" ||
        job.status === "save_failed" ||
        job.status === "failed"
      ) {
        appliedJobIdRef.current = job.id;
      }
      return;
    }
    if (job.status === "failed") {
      if (appliedJobIdRef.current === job.id) {
        setGenerateBusy(false);
        return;
      }
      appliedJobIdRef.current = job.id;
      setGenerateBusy(false);
      if (job.errorMessage) reportErrorOnce(job.errorMessage);
      // Clear immediately — a stuck 0% failed overlay freezes the preview.
      if (progressClearTimerRef.current != null) {
        window.clearTimeout(progressClearTimerRef.current);
        progressClearTimerRef.current = null;
      }
      setGenerationProgress(null);
      return;
    }
    if (job.status === "queued" || job.status === "running") {
      setGenerateBusy(true);
      setGenerationProgress((prev) => ({
        stage: "generating",
        percent: Math.max(prev?.percent ?? 38, job.estimatedPercent ?? 38),
        message: "正在生成图片",
      }));
      return;
    }
    if (job.status !== "succeeded" && job.status !== "save_failed") return;
    if (!job.primaryMediaId) return;
    if (appliedJobIdRef.current === job.id) return;
    appliedJobIdRef.current = job.id;
    void applyGeneratedResult(
      [job.primaryMediaId, ...job.mediaIds].filter(
        (id, index, list) => Boolean(id) && list.indexOf(id) === index,
      ),
      job.id,
    );
  }, [applyGeneratedResult, clearProgressLater, imageJob.job, reportErrorOnce]);

  useEffect(() => {
    const job = imageJob.job;
    if (!job || job.status !== "failed") return;
    const next: { prompt?: boolean; referenceImages?: boolean } = {};
    if (job.errorFields.includes("prompt")) next.prompt = true;
    if (job.errorFields.includes("referenceImages")) next.referenceImages = true;
    if (Object.keys(next).length > 0) setFieldErrors(next);
  }, [imageJob.job]);

  useEffect(() => {
    referenceSlotsRef.current = referenceSlots;
  }, [referenceSlots]);

  useEffect(
    () => () => revokeAssetImageEditSlots(referenceSlotsRef.current),
    [],
  );

  const handleClose = useCallback(() => {
    revokeAssetImageEditSlots(referenceSlotsRef.current);
    referenceSlotsRef.current = emptyAssetImageEditSlots();
    setReferenceSlots(emptyAssetImageEditSlots());
    onClose();
  }, [onClose]);

  const usedPersonalMaterialIds = useMemo(
    () =>
      referenceSlots.flatMap((slot) => {
        if (!slot) return [];
        if (slot.source === "personal-material") return [slot.personalMaterialId];
        if (slot.source === "system-material") return [slot.personalMaterialId];
        if (slot.source === "upload" && slot.personalMaterialId) {
          return [slot.personalMaterialId];
        }
        return [];
      }),
    [referenceSlots],
  );
  const usedSystemMaterialIds = useMemo(
    () =>
      referenceSlots.flatMap((slot) =>
        slot?.source === "system-material" ? [slot.materialId] : [],
      ),
    [referenceSlots],
  );

  const applySlot = useCallback(
    (index: number, nextSlot: AssetImageEditReferenceSlot) => {
      setReferenceSlots((prev) => {
        const next = [...prev];
        if (next[index]) revokeAssetImageEditSlots([next[index]]);
        next[index] = nextSlot;
        return next;
      });
    },
    [],
  );

  const handleMaterialPick = useCallback(
    (selection: MaterialPickerSelection) => {
      if (pickerSlotIndex == null) return;
      const duplicate = referenceSlots.some((slot, index) => {
        if (index === pickerSlotIndex || !slot) return false;
        if (
          "personalMaterialId" in slot &&
          slot.personalMaterialId &&
          slot.personalMaterialId === selection.personalMaterialId
        ) {
          return true;
        }
        if (
          selection.source === "system-material" &&
          slot.source === "system-material" &&
          selection.materialId &&
          slot.materialId === selection.materialId
        ) {
          return true;
        }
        return false;
      });
      if (duplicate) {
        setError("同一素材不能重复占用多个参考图槽位");
        setFieldErrors({ referenceImages: true });
        return;
      }
      setError("");
      if (selection.source === "personal-material") {
        applySlot(pickerSlotIndex, {
          source: "personal-material",
          personalMaterialId: selection.personalMaterialId,
          mediaId: selection.mediaId,
          previewUrl: selection.previewUrl,
          name: selection.name,
        });
      } else {
        applySlot(pickerSlotIndex, {
          source: "system-material",
          materialId: selection.materialId ?? "",
          personalMaterialId: selection.personalMaterialId,
          mediaId: selection.mediaId,
          previewUrl: selection.previewUrl,
          name: selection.name,
        });
      }
      setPickerSlotIndex(null);
    },
    [applySlot, pickerSlotIndex, referenceSlots],
  );

  const confirmUploadSlot = useCallback(async () => {
    if (!pendingPersonalUpload) return;
    const { slotIndex, file, previewUrl } = pendingPersonalUpload;
    if (!saveToPersonal) {
      applySlot(slotIndex, { source: "upload", file, previewUrl });
      setPendingPersonalUpload(null);
      setSaveToPersonal(false);
      return;
    }
    setPersonalSaveBusy(true);
    setError("");
    try {
      const uploadForm = new FormData();
      uploadForm.set("file", file);
      const uploadRes = await fetch("/api/materials/upload", {
        method: "POST",
        body: uploadForm,
        credentials: "include",
      });
      const uploadData = await parseResponseJson<{
        mediaId?: string;
        error?: string;
      }>(uploadRes);
      if (!uploadRes.ok || !uploadData.mediaId) {
        throw new Error(uploadData.error || "上传失败");
      }
      const name =
        personalMeta.name.trim() ||
        file.name.replace(/\.[^.]+$/, "") ||
        "个人参考图";
      const createRes = await fetch("/api/materials/my-library", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: personalMeta.type,
          mediaId: uploadData.mediaId,
          description: personalMeta.description,
          tags: personalMeta.tags
            .split(/[,，\s]+/)
            .map((t) => t.trim())
            .filter(Boolean),
          sourceType: "upload",
        }),
      });
      const createData = await parseResponseJson<{
        material?: { id: string; name: string; mediaId: string };
        error?: string;
      }>(createRes);
      if (!createRes.ok || !createData.material) {
        throw new Error(createData.error || "保存个人素材失败");
      }
      applySlot(slotIndex, {
        source: "personal-material",
        personalMaterialId: createData.material.id,
        mediaId: createData.material.mediaId,
        previewUrl,
        name: createData.material.name,
      });
      setPendingPersonalUpload(null);
      setSaveToPersonal(false);
      setPersonalMeta({
        name: "",
        type: "clothing",
        description: "",
        tags: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPersonalSaveBusy(false);
    }
  }, [applySlot, pendingPersonalUpload, personalMeta, saveToPersonal]);

  const cancelPendingUpload = useCallback(() => {
    if (pendingPersonalUpload?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(pendingPersonalUpload.previewUrl);
    }
    setPendingPersonalUpload(null);
    setSaveToPersonal(false);
  }, [pendingPersonalUpload]);

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;

  const commitLookName = useCallback(async () => {
    if (!boundAppearanceId) return;
    const nextName = lookName.trim();
    if (!nextName) {
      reportErrorOnce("造型名称不能为空");
      return;
    }
    if (nextName === committedLookNameRef.current) return;
    try {
      const response = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(characterId)}/media`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename-appearance",
            appearanceId: boundAppearanceId,
            displayName: nextName,
          }),
        },
      );
      const payload = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
        appearance?: { id: string };
      }>(response);
      if (!payload || !response.ok || !payload.character) {
        throw new Error(payload?.error ?? "重命名造型失败");
      }
      committedLookNameRef.current = nextName;
      onSaved({
        mediaId: currentLookMediaId ?? "",
        character: payload.character,
        appearanceId: boundAppearanceId,
      });
      setNotice("造型名称已更新");
    } catch (caught) {
      reportErrorOnce(
        caught instanceof Error ? caught.message : "重命名造型失败",
      );
    }
  }, [
    apiRoot,
    boundAppearanceId,
    characterId,
    currentLookMediaId,
    lookName,
    onSaved,
    reportErrorOnce,
  ]);
  const previewUrl = useMemo(
    () =>
      currentLookMediaId
        ? getProjectAssetImageUrl(projectId, currentLookMediaId, {
            revision: currentLookMediaId,
            context,
          })
        : null,
    [currentLookMediaId, projectId, context],
  );
  const sessionOwnsCurrentJob = Boolean(
    imageJob.job?.id && ownedJobIdsRef.current.has(imageJob.job.id),
  );
  const busy =
    generateBusy ||
    generateInFlightRef.current ||
    (imageJob.generationBlocked && sessionOwnsCurrentJob);
  const canRetryOwned = Boolean(imageJob.canRetry && sessionOwnsCurrentJob);
  const canGenerate =
    Boolean(prompt.trim()) &&
    referenceSlots.some(Boolean) &&
    !busy &&
    !validating;
  const currentCertified = Boolean(
    currentLookMediaId && certifiedMediaIds.has(currentLookMediaId),
  );
  const modelLabel =
    DESIGN_IMAGE_MODELS.find((model) => model.id === imageModelId)?.label ??
    imageModelId;
  const generationSummary = `生成预览 · ${
    DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]
  } · ${imageOptions.aspectRatio} · ${imageOptions.count}张 · ${modelLabel}`;

  const buildGenerateForm = useCallback(() => {
    const form = new FormData();
    form.set("assetId", characterId);
    form.set("assetKind", "character");
    form.set("mode", "image_to_image");
    form.set("model", imageModelId);
    form.set("prompt", prompt.trim());
    form.set("idempotencyKey", safeRandomUUID());
    form.set("quality", imageOptions.quality);
    form.set("aspectRatio", imageOptions.aspectRatio || "16:9");
    form.set("count", String(imageOptions.count));
    // Never replace the character main / primary media from look generation.
    form.set("setPrimary", "false");
    const referenceSources: Array<Record<string, unknown>> = [];
    referenceSlots.forEach((slot, index) => {
      if (!slot) return;
      if (slot.source === "asset-media") {
        referenceSources.push({
          slot: index,
          sourceType: "project-asset",
          mediaId: slot.mediaId,
        });
        form.set(`referenceMediaId[${index}]`, slot.mediaId);
        return;
      }
      if (slot.source === "upload") {
        referenceSources.push({ slot: index, sourceType: "upload" });
        form.set(`referenceImage[${index}]`, slot.file);
        return;
      }
      if (slot.source === "personal-material") {
        referenceSources.push({
          slot: index,
          sourceType: "personal-material",
          personalMaterialId: slot.personalMaterialId,
        });
        return;
      }
      if (slot.source === "system-material") {
        referenceSources.push({
          slot: index,
          sourceType: "system-material",
          materialId: slot.materialId,
          personalMaterialId: slot.personalMaterialId,
        });
      }
    });
    if (referenceSources.length > 0) {
      form.set("referenceSources", JSON.stringify(referenceSources));
    }
    return form;
  }, [characterId, imageModelId, imageOptions, prompt, referenceSlots]);

  const handleGenerate = useCallback(async () => {
    const ownsActive =
      Boolean(imageJob.job?.id) &&
      ownedJobIdsRef.current.has(imageJob.job!.id) &&
      imageJob.generationBlocked;
    if (generateInFlightRef.current || ownsActive) {
      reportErrorOnce("该素材正在生成中，请等待完成后再试。");
      return;
    }
    const retryOwned =
      imageJob.canRetry &&
      Boolean(imageJob.job?.id) &&
      ownedJobIdsRef.current.has(imageJob.job!.id);
    if (retryOwned) {
      generateInFlightRef.current = true;
      claimJobForSession(imageJob.job?.id);
      setGenerateBusy(true);
      setError("");
      lastErrorKeyRef.current = null;
      setNotice("");
      setGenerationProgress({
        stage: "submitted",
        percent: 22,
        message: "已提交生成任务",
      });
      const result = await imageJob.retryFromServer();
      if (!result.ok) {
        reportErrorOnce(result.error);
        if (result.code === "REFERENCE_IMAGE_REQUIRED") {
          setFieldErrors({ referenceImages: true });
        }
        if (progressClearTimerRef.current != null) {
          window.clearTimeout(progressClearTimerRef.current);
          progressClearTimerRef.current = null;
        }
        setGenerationProgress(null);
        setGenerateBusy(false);
      } else {
        claimJobForSession(result.job?.id ?? imageJob.job?.id);
        setNotice("已按原参数重新提交生成。");
        setGenerationProgress({
          stage: "generating",
          percent: 38,
          message: "正在生成图片",
        });
      }
      generateInFlightRef.current = false;
      return;
    }
    if (!canGenerate) return;

    generateInFlightRef.current = true;
    claimJobForSession(null);
    setGenerateBusy(true);
    setError("");
    lastErrorKeyRef.current = null;
    setNotice("");
    setFieldErrors({});
    try {
      setGenerationProgress({
        stage: "validating",
        percent: 8,
        message: "正在校验参考图",
      });
      await nextFrame();

      const form = buildGenerateForm();
      form.set("sourceEntry", "library_look");

      setGenerationProgress({
        stage: "submitted",
        percent: 22,
        message: "已提交生成任务",
      });
      await nextFrame();
      setGenerationProgress({
        stage: "generating",
        percent: 38,
        message: "正在生成图片",
      });

      const response = await fetch(`${apiRoot}/assets-draft/media/generate`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const payload = await parseResponseJson<{
        error?: string;
        code?: string;
        async?: boolean;
        jobId?: string;
        job?: Parameters<typeof imageJob.beginFromGenerateResponse>[0]["job"];
        mediaId?: string;
        mediaIds?: string[];
        notice?: string;
      }>(response, { allowEmpty: response.status === 202 });
      if (!payload) {
        if (response.status === 202 || response.ok) {
          setNotice("已提交生成任务，预计进度见预览区。");
          void imageJob.refreshLatest().then((job) => {
            if (job?.sourceEntry === "library_look") {
              claimJobForSession(job.id);
            }
          });
          return;
        }
        throw new Error("服务器没有返回有效数据，请稍后重试。");
      }
      if (!response.ok) {
        if (payload.code === "INVALID_PARAMS" || payload.code === "PROMPT_REQUIRED") {
          setFieldErrors({ prompt: true });
        }
        if (
          payload.code === "REFERENCE_IMAGE_REQUIRED" ||
          payload.code === "IMAGE_TO_IMAGE_REQUIRED"
        ) {
          setFieldErrors({ referenceImages: true });
        }
        throw new Error(payload.error ?? "生成造型失败");
      }
      if (payload.async && (payload.jobId || payload.job)) {
        claimJobForSession(payload.jobId ?? payload.job?.id);
        imageJob.beginFromGenerateResponse(payload);
        setNotice("已提交生成任务，预计进度见预览区。");
        return;
      }
      const mediaIds = payload.mediaIds?.length
        ? payload.mediaIds
        : payload.mediaId
          ? [payload.mediaId]
          : [];
      if (mediaIds.length === 0) throw new Error("生成结果中没有图片");
      await applyGeneratedResult(mediaIds, null);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "生成造型失败";
      reportErrorOnce(message);
      if (progressClearTimerRef.current != null) {
        window.clearTimeout(progressClearTimerRef.current);
        progressClearTimerRef.current = null;
      }
      setGenerationProgress(null);
      setGenerateBusy(false);
    } finally {
      generateInFlightRef.current = false;
      // Do not clear generationProgress here — success timers own that.
    }
  }, [
    apiRoot,
    applyGeneratedResult,
    buildGenerateForm,
    canGenerate,
    claimJobForSession,
    clearProgressLater,
    imageJob,
    reportErrorOnce,
  ]);

  const handlePrecheck = useCallback(async () => {
    if (!currentLookMediaId || validating || busy) {
      return;
    }
    setValidating(true);
    setError("");
    lastErrorKeyRef.current = null;
    setNotice("");
    try {
      const result = await postLibrarySd2Precheck({
        apiRoot,
        assetId: characterId,
        mediaId: currentLookMediaId,
      });
      if (result.videoRefSafety && isSd2CertifiedForVideoRef(result.videoRefSafety)) {
        setCertifiedMediaIds((previous) =>
          new Set(previous).add(currentLookMediaId),
        );
        setNotice(result.notice || "人物校验完成");
        // Retry linking a new look after certification if needed.
        if (!boundAppearanceId && lookName.trim()) {
          try {
            await persistGeneratedMedia(currentLookMediaId, imageJob.job?.id);
          } catch {
            /* keep certified state; user can regenerate or reopen */
          }
        }
        return;
      }
      reportErrorOnce(result.error || result.notice || "人物校验未通过");
    } catch (caught) {
      reportErrorOnce(
        caught instanceof Error ? caught.message : "人物校验失败",
      );
    } finally {
      setValidating(false);
    }
  }, [
    apiRoot,
    boundAppearanceId,
    busy,
    characterId,
    currentLookMediaId,
    imageJob.job?.id,
    lookName,
    persistGeneratedMedia,
    reportErrorOnce,
    validating,
  ]);

  // New look: never render history. Existing look: optional history UI.
  // historyEnabled frozen at open (openedAsNewLook).

  return (
    <>
      <AssetImageEditPanel
        variant="character-look"
        title={
          boundAppearanceId
            ? `生成角色造型 · ${characterName}`
            : `新增人物造型 · ${characterName}`
        }
        previewUrl={previewUrl}
        emptyPreviewLabel="暂无预览"
        historyIds={lookHistoryIds}
        currentMediaId={currentLookMediaId}
        historyThumbUrl={(mediaId) =>
          getProjectAssetImageUrl(projectId, mediaId, {
            revision: mediaId,
            context,
          })
        }
        showHistory={historyEnabled && showHistory}
        showHistoryToggle={historyEnabled}
        onToggleHistory={() => setShowHistory((visible) => !visible)}
        onSelectHistory={setCurrentLookMediaId}
        referenceSlots={referenceSlots}
        onReferenceSlotsChange={setReferenceSlots}
        enableMaterialLibraryPick
        onPickMaterialLibrary={(index) => setPickerSlotIndex(index)}
        onUploadWithPersonalSaveOption={(slotIndex, file, previewUrl) => {
          setPendingPersonalUpload({ slotIndex, file, previewUrl });
          setSaveToPersonal(false);
          setPersonalMeta({
            name: file.name.replace(/\.[^.]+$/, "") || "",
            type: "clothing",
            description: "",
            tags: "",
          });
        }}
        imageEditPrompt={prompt}
        onImageEditPromptChange={setPrompt}
        lookName={lookName}
        onLookNameChange={setLookName}
        onLookNameBlur={() => void commitLookName()}
        inheritHint="默认继承主形象人脸与身份；提示词只写服装、年龄、伤病、发型等造型变化。"
        promptLabel="造型提示词"
        promptPlaceholder="只描述服装、年龄、伤病、发型、妆容、状态等造型变化；默认继承主形象人脸、身份与基础体型。"
        imageOptions={imageOptions}
        onImageOptionsChange={setImageOptions}
        imageModelId={imageModelId}
        onImageModelIdChange={setImageModelId}
        generationSummary={generationSummary}
        generateBusy={busy}
        generationProgress={generationProgress}
        precheckCertified={currentCertified}
        canGenerate={canGenerate || canRetryOwned}
        canSave={false}
        generateLabel="生成造型"
        precheckBusy={validating}
        canPrecheck={Boolean(currentLookMediaId) && !currentCertified}
        onPrecheck={() => void handlePrecheck()}
        precheckLabel="人物校验"
        fieldErrors={fieldErrors}
        error={error}
        notice={
          notice || (sessionOwnsCurrentJob ? imageJob.serviceNotice : "")
        }
        onGenerate={() => void handleGenerate()}
        onClose={handleClose}
      />
      <ImageGenerationTaskPanel
        projectId={projectId}
        context={context}
        job={imageJob.job}
        hideSucceededPreview
        fieldErrors={fieldErrors}
        canRetry={imageJob.canRetry}
        busyAction={imageJob.busyAction}
        serviceNotice={imageJob.serviceNotice}
        timeoutDialogOpen={imageJob.timeoutDialogOpen}
        deleteConfirmOpen={imageJob.deleteConfirmOpen}
        onRetry={() => void handleGenerate()}
        onRetrySave={() => undefined}
        onRequestDeletePending={() => imageJob.setDeleteConfirmOpen(true)}
        onContinueWait={() => void imageJob.continueWaiting()}
        onDismissTimeout={() => imageJob.setTimeoutDialogOpen(false)}
        onRedetectService={() => void imageJob.redetectService()}
        onReplaceReferences={(files) => {
          void imageJob.replaceReferences(files).then((result) => {
            if (!result.ok) reportErrorOnce(result.error);
            else setNotice("参考图已更新，可点击使用原参数重试。");
          });
        }}
        needsReferenceReplace={imageJob.needsReferenceReplace}
        retrySnapshotIncomplete={imageJob.retrySnapshotIncomplete}
        onConfirmDeletePending={() => void imageJob.confirmDeletePending()}
        onCancelDeletePending={() => imageJob.setDeleteConfirmOpen(false)}
      />
      <MaterialPickerModal
        open={pickerSlotIndex != null}
        onClose={() => setPickerSlotIndex(null)}
        onSelect={handleMaterialPick}
        slotIndex={pickerSlotIndex}
        usedPersonalMaterialIds={usedPersonalMaterialIds}
        usedSystemMaterialIds={usedSystemMaterialIds}
        preventDuplicate
      />
      {pendingPersonalUpload ? (
        <div
          className="aie-panel__upload-save-mask"
          data-testid="look-upload-save-dialog"
        >
          <div className="aie-panel__upload-save-card" role="dialog">
            <h3>使用上传图片</h3>
            <label className="aie-panel__upload-save-check">
              <input
                type="checkbox"
                checked={saveToPersonal}
                onChange={(e) => setSaveToPersonal(e.target.checked)}
                data-testid="look-upload-save-to-personal"
              />
              同时保存到个人空间
            </label>
            {saveToPersonal ? (
              <div className="aie-panel__upload-save-fields">
                <label>
                  名称
                  <input
                    value={personalMeta.name}
                    onChange={(e) =>
                      setPersonalMeta((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  分类
                  <select
                    value={personalMeta.type}
                    onChange={(e) =>
                      setPersonalMeta((prev) => ({
                        ...prev,
                        type: e.target.value as MaterialType,
                      }))
                    }
                  >
                    <option value="character">人物形象</option>
                    <option value="clothing">衣服</option>
                    <option value="prop">道具</option>
                    <option value="scene">场景</option>
                  </select>
                </label>
                <label>
                  描述
                  <textarea
                    value={personalMeta.description}
                    onChange={(e) =>
                      setPersonalMeta((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    rows={2}
                  />
                </label>
                <label>
                  标签（逗号分隔）
                  <input
                    value={personalMeta.tags}
                    onChange={(e) =>
                      setPersonalMeta((prev) => ({
                        ...prev,
                        tags: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="aie-panel__upload-save-hint">
                默认仅本次使用：图片只进入当前造型编辑器，生成后不会自动进入个人空间。
              </p>
            )}
            <div className="aie-panel__upload-save-actions">
              <button type="button" onClick={cancelPendingUpload}>
                取消
              </button>
              <button
                type="button"
                disabled={personalSaveBusy}
                data-testid="look-upload-confirm"
                onClick={() => void confirmUploadSlot()}
              >
                {personalSaveBusy
                  ? "保存中…"
                  : saveToPersonal
                    ? "保存到个人空间并使用"
                    : "仅本次使用"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
