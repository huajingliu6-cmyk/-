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
import type { DesignImageGenerationOptions } from "@/projects/assets/episode-design/image-generation-options";
import type { DesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import type { SceneCharacterPlacement } from "@/projects/storyboard/types";
import { SceneCharacterPlacementEditor } from "@/projects/storyboard/components/SceneCharacterPlacementEditor";
import { useLibraryImageGenerationJob } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { ImageGenerationTaskPanel } from "@/projects/assets/image-generation/ImageGenerationTaskPanel";
import "@/projects/assets/asset-workspace.css";

export type StoryboardAssetImageEditorProps = {
  open: boolean;
  projectId: string;
  asset: PickerAsset;
  initialMediaId: string | null;
  shotCharacterAssets: PickerAsset[];
  sceneCharacterPlacements: SceneCharacterPlacement[];
  shotAssetMediaIds: Record<string, string>;
  onClose: () => void;
  onMediaSaved: (mediaId: string) => Promise<void> | void;
  onAssetsChanged: () => Promise<void> | void;
  onSavePlacements: (
    placements: SceneCharacterPlacement[],
  ) => Promise<void> | void;
};

type SavedMediaCandidate = {
  assetId: string;
  assetKind: "character" | "prop" | "scene";
  mediaId: string;
};

export function StoryboardAssetImageEditor({
  open,
  projectId,
  asset,
  initialMediaId,
  shotCharacterAssets,
  sceneCharacterPlacements,
  shotAssetMediaIds,
  onClose,
  onMediaSaved,
  onAssetsChanged,
  onSavePlacements,
}: StoryboardAssetImageEditorProps) {
  const [currentMediaId, setCurrentMediaId] = useState<string | null>(
    initialMediaId,
  );
  const [historyIds, setHistoryIds] = useState<string[]>(() =>
    initialMediaId ? [initialMediaId] : [],
  );
  const [showHistory, setShowHistory] = useState(false);
  const [referenceSlots, setReferenceSlots] = useState<
    AssetImageEditReferenceSlot[]
  >(() => {
    const slots = emptyAssetImageEditSlots();
    if (initialMediaId) {
      slots[0] = {
        source: "asset-media",
        mediaId: initialMediaId,
        previewUrl: getProjectAssetImageUrl(projectId, initialMediaId, {
          revision: initialMediaId,
        }),
      };
    }
    return slots;
  });
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [imageOptions, setImageOptions] = useState<DesignImageGenerationOptions>(
    DEFAULT_DESIGN_IMAGE_OPTIONS,
  );
  const [imageModelId, setImageModelId] = useState<DesignImageModelId>(
    DEFAULT_DESIGN_IMAGE_MODEL_ID,
  );
  const [generateBusy, setGenerateBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedMediaIds, setSavedMediaIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    prompt?: boolean;
    referenceImages?: boolean;
  }>({});
  const [placementEditorOpen, setPlacementEditorOpen] = useState(false);
  const [savedMediaCandidate, setSavedMediaCandidate] =
    useState<SavedMediaCandidate | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const referenceSlotsRef = useRef(referenceSlots);
  const lastGenerateFormRef = useRef<FormData | null>(null);

  const imageJob = useLibraryImageGenerationJob({
    projectId,
    context: "management",
    assetId: asset.id,
    assetKind: asset.kind,
    enabled: open,
  });

  useEffect(() => {
    referenceSlotsRef.current = referenceSlots;
  }, [referenceSlots]);

  useEffect(() => {
    return () => {
      revokeAssetImageEditSlots(referenceSlotsRef.current);
    };
  }, []);

  useEffect(() => {
    const job = imageJob.job;
    if (!job?.primaryMediaId) return;
    if (job.status !== "succeeded" && job.status !== "save_failed") return;
    setCurrentMediaId(job.primaryMediaId);
    setHistoryIds((prev) => {
      const next = [...prev];
      for (const id of job.mediaIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    setShowHistory(true);
    setGenerateBusy(false);
  }, [imageJob.job]);

  useEffect(() => {
    const job = imageJob.job;
    if (!job || job.status !== "failed") return;
    const next: { prompt?: boolean; referenceImages?: boolean } = {};
    if (job.errorFields.includes("prompt")) next.prompt = true;
    if (job.errorFields.includes("referenceImages")) next.referenceImages = true;
    if (Object.keys(next).length > 0) setFieldErrors(next);
    if (job.errorMessage) setError(job.errorMessage);
  }, [imageJob.job]);

  const previewUrl = useMemo(() => {
    if (!currentMediaId) return null;
    return getProjectAssetImageUrl(projectId, currentMediaId, {
      revision: currentMediaId,
    });
  }, [currentMediaId, projectId]);

  const filledReferenceCount = referenceSlots.filter(Boolean).length;
  const canGenerate =
    (Boolean(imageEditPrompt.trim()) ||
      (asset.kind === "scene" && sceneCharacterPlacements.length > 0)) &&
    filledReferenceCount > 0 &&
    !generateBusy &&
    !imageJob.generationBlocked;
  const canSave = Boolean(currentMediaId) && !saveBusy;

  const buildGenerateForm = useCallback(() => {
    const form = new FormData();
    form.set("assetId", asset.id);
    form.set("assetKind", asset.kind);
    form.set("mode", "image_to_image");
    form.set("model", imageModelId);
    form.set("prompt", imageEditPrompt.trim());
    form.set("idempotencyKey", safeRandomUUID());
    form.set("quality", imageOptions.quality);
    form.set("aspectRatio", imageOptions.aspectRatio);
    form.set("count", String(imageOptions.count));
    if (asset.kind === "scene" && sceneCharacterPlacements.length > 0) {
      form.set(
        "sceneCharacterPlacements",
        JSON.stringify(sceneCharacterPlacements),
      );
      for (const placement of sceneCharacterPlacements) {
        const mediaId =
          shotAssetMediaIds[placement.characterAssetId] ||
          shotCharacterAssets
            .find((c) => c.id === placement.characterAssetId)
            ?.mediaOptions?.find((m) => m.isPrimary)?.mediaId ||
          shotCharacterAssets.find((c) => c.id === placement.characterAssetId)
            ?.mediaOptions?.[0]?.mediaId;
        if (mediaId) {
          form.set(`characterMediaId[${placement.characterAssetId}]`, mediaId);
        }
      }
    }
    referenceSlots.forEach((slot, index) => {
      if (!slot) return;
      if (slot.source === "asset-media") {
        form.set(`referenceMediaId[${index}]`, slot.mediaId);
      } else if (slot.source === "upload") {
        form.set(`referenceImage[${index}]`, slot.file);
      }
    });
    return form;
  }, [
    asset.id,
    asset.kind,
    imageEditPrompt,
    imageModelId,
    imageOptions,
    referenceSlots,
    sceneCharacterPlacements,
    shotAssetMediaIds,
    shotCharacterAssets,
  ]);

  const handleGenerate = useCallback(async () => {
    if (imageJob.canRetry) {
      setGenerateBusy(true);
      setError("");
      setNotice("");
      const result = await imageJob.retryFromServer();
      if (!result.ok) {
        setError(result.error);
        if (result.code === "REFERENCE_IMAGE_REQUIRED") {
          setFieldErrors({ referenceImages: true });
        }
      } else {
        setNotice("已按原参数重新提交生成。");
      }
      setGenerateBusy(false);
      return;
    }
    if (!canGenerate) return;
    if (imageJob.generationBlocked) {
      setError("该素材正在生成中，请等待完成后再试。");
      return;
    }
    if (!referenceSlots.some(Boolean)) {
      setError("缺少参考图片");
      setFieldErrors({ referenceImages: true });
      return;
    }
    setGenerateBusy(true);
    setError("");
    setNotice("");
    setFieldErrors({});
    imageJob.setServiceNotice("");
    try {
      const form = buildGenerateForm();
      form.set("sourceEntry", "storyboard_image");
      lastGenerateFormRef.current = form;

      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/assets-draft/media/generate`,
        { method: "POST", body: form, credentials: "include" },
      );
      const payload = (await res.json()) as {
        error?: string;
        code?: string;
        async?: boolean;
        jobId?: string;
        job?: Parameters<typeof imageJob.beginFromGenerateResponse>[0]["job"];
        mediaId?: string;
        mediaIds?: string[];
        notice?: string;
      };
      if (!res.ok) {
        if (payload.code === "INVALID_PARAMS" || payload.code === "PROMPT_REQUIRED") {
          setFieldErrors({ prompt: true });
        }
        if (
          payload.code === "REFERENCE_IMAGE_REQUIRED" ||
          payload.code === "IMAGE_TO_IMAGE_REQUIRED"
        ) {
          setFieldErrors({ referenceImages: true });
        }
        throw new Error(payload.error ?? "图生图失败");
      }
      if (payload.async && (payload.jobId || payload.job)) {
        imageJob.beginFromGenerateResponse(payload);
        setNotice("已提交生成任务，预计进度见下方。");
        return;
      }
      const mediaIds = payload.mediaIds?.length
        ? payload.mediaIds
        : payload.mediaId
          ? [payload.mediaId]
          : [];
      if (mediaIds.length === 0) {
        throw new Error("未返回生成图片");
      }
      const nextCurrent = mediaIds[0]!;
      setCurrentMediaId(nextCurrent);
      setHistoryIds((prev) => {
        const next = [...prev];
        for (const id of mediaIds) {
          if (!next.includes(id)) next.push(id);
        }
        return next;
      });
      setShowHistory(true);
      setNotice(payload.notice ?? `已生成 ${mediaIds.length} 张`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "图生图失败");
    } finally {
      if (!imageJob.generationBlocked) setGenerateBusy(false);
    }
  }, [buildGenerateForm, canGenerate, imageJob, projectId, referenceSlots]);

  const handleSave = useCallback(async () => {
    if (!currentMediaId || savedMediaIds.has(currentMediaId)) return;
    setSaveBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/assets-draft/media/save`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: asset.id,
            assetKind: asset.kind,
            mediaId: currentMediaId,
            setPrimary: false,
          }),
        },
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "保存图片失败");
      }
      setSavedMediaIds((prev) => new Set(prev).add(currentMediaId));
      await imageJob.markSaved();
      await onAssetsChanged();
      setSavedMediaCandidate({
        assetId: asset.id,
        assetKind: asset.kind,
        mediaId: currentMediaId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "保存图片失败";
      setError(message);
      await imageJob.markSaveFailed(message);
    } finally {
      setSaveBusy(false);
    }
  }, [
    asset.id,
    asset.kind,
    currentMediaId,
    imageJob,
    onAssetsChanged,
    projectId,
    savedMediaIds,
  ]);

  if (!open) return null;

  return (
    <>
      <AssetImageEditPanel
        title={`编辑图片 · ${asset.name}`}
        previewUrl={previewUrl}
        historyIds={historyIds}
        currentMediaId={currentMediaId}
        historyThumbUrl={(mediaId) =>
          getProjectAssetImageUrl(projectId, mediaId, { revision: mediaId })
        }
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onSelectHistory={(mediaId) => setCurrentMediaId(mediaId)}
        referenceSlots={referenceSlots}
        onReferenceSlotsChange={setReferenceSlots}
        imageEditPrompt={imageEditPrompt}
        onImageEditPromptChange={setImageEditPrompt}
        imageOptions={imageOptions}
        onImageOptionsChange={setImageOptions}
        imageModelId={imageModelId}
        onImageModelIdChange={setImageModelId}
        generateBusy={generateBusy || imageJob.generationBlocked}
        saveBusy={saveBusy}
        saved={Boolean(currentMediaId && savedMediaIds.has(currentMediaId))}
        canGenerate={canGenerate || imageJob.canRetry}
        canSave={canSave}
        fieldErrors={fieldErrors}
        error={error}
        notice={notice || imageJob.serviceNotice}
        sceneActions={
          asset.kind === "scene" ? (
            <button
              type="button"
              className="amw-btn"
              data-testid="aie-placement-open"
              disabled={generateBusy || imageJob.generationBlocked}
              onClick={() => setPlacementEditorOpen(true)}
            >
              人物位置
            </button>
          ) : null
        }
        onGenerate={() => void handleGenerate()}
        onSave={() => void handleSave()}
        onClose={onClose}
      />

      <ImageGenerationTaskPanel
        projectId={projectId}
        context="management"
        job={imageJob.job}
        fieldErrors={fieldErrors}
        canRetry={imageJob.canRetry}
        busyAction={imageJob.busyAction}
        serviceNotice={imageJob.serviceNotice}
        timeoutDialogOpen={imageJob.timeoutDialogOpen}
        deleteConfirmOpen={imageJob.deleteConfirmOpen}
        onRetry={() => void handleGenerate()}
        onRetrySave={() => void handleSave()}
        onRequestDeletePending={() => imageJob.setDeleteConfirmOpen(true)}
        onContinueWait={() => void imageJob.continueWaiting()}
        onDismissTimeout={() => imageJob.setTimeoutDialogOpen(false)}
        onRedetectService={() => void imageJob.redetectService()}
        onReplaceReferences={(files) => {
          void imageJob.replaceReferences(files).then((result) => {
            if (!result.ok) setError(result.error);
            else setNotice("参考图已更新，可点击使用原参数重试。");
          });
        }}
        needsReferenceReplace={imageJob.needsReferenceReplace}
        retrySnapshotIncomplete={imageJob.retrySnapshotIncomplete}
        onConfirmDeletePending={() => void imageJob.confirmDeletePending()}
        onCancelDeletePending={() => imageJob.setDeleteConfirmOpen(false)}
      />

      {placementEditorOpen && asset.kind === "scene" ? (
        <SceneCharacterPlacementEditor
          key={`placement:${asset.id}:${sceneCharacterPlacements
            .map((p) => `${p.characterAssetId}:${p.x}:${p.y}`)
            .join("|")}`}
          open={placementEditorOpen}
          projectId={projectId}
          sceneMediaId={currentMediaId}
          characters={shotCharacterAssets}
          initialPlacements={sceneCharacterPlacements}
          onCancel={() => setPlacementEditorOpen(false)}
          onSave={async (next) => {
            await onSavePlacements(next);
            setPlacementEditorOpen(false);
          }}
        />
      ) : null}

      {savedMediaCandidate ? (
        <div
          className="aie-save-confirm"
          role="dialog"
          aria-modal="true"
          data-testid="aie-save-confirm"
        >
          <div className="aie-save-confirm__card">
            <p>图片已保存，是否将此图添加至当前镜头素材？</p>
            {error ? (
              <p className="ead-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="aie-save-confirm__actions">
              <button
                type="button"
                className="amw-btn"
                disabled={applyBusy}
                data-testid="aie-save-skip"
                onClick={() => setSavedMediaCandidate(null)}
              >
                暂不添加
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={applyBusy}
                data-testid="aie-save-apply"
                onClick={() => {
                  void (async () => {
                    setApplyBusy(true);
                    setError("");
                    try {
                      await onMediaSaved(savedMediaCandidate.mediaId);
                      setSavedMediaCandidate(null);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "添加至镜头失败",
                      );
                    } finally {
                      setApplyBusy(false);
                    }
                  })();
                }}
              >
                {applyBusy ? "添加中…" : "添加至镜头"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
