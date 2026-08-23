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
import type { DesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import { safeRandomUUID } from "@/lib/safe-random-id";
import { useLibraryImageGenerationJob } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { ImageGenerationTaskPanel } from "@/projects/assets/image-generation/ImageGenerationTaskPanel";

type LibraryAssetKind = "character" | "scene" | "prop";

export type LibraryAssetImageSaveResult = {
  mediaId: string;
  approvedMediaIds: string[];
  primaryMediaId: string | null;
};

type Props = {
  projectId: string;
  context: "management" | "workspace";
  assetId: string;
  assetKind: LibraryAssetKind;
  assetName: string;
  initialMediaId: string | null;
  existingMediaIds: string[];
  initialPrompt?: string;
  setPrimaryOnSave?: boolean;
  onClose: () => void;
  onSaved: (result: LibraryAssetImageSaveResult) => void;
};

function makeInitialSlots(
  projectId: string,
  mediaId: string | null,
  context: "management" | "workspace",
): AssetImageEditReferenceSlot[] {
  const slots = emptyAssetImageEditSlots();
  if (mediaId) {
    slots[0] = {
      source: "asset-media",
      mediaId,
      previewUrl: getProjectAssetImageUrl(projectId, mediaId, {
        revision: mediaId,
        context,
      }),
    };
  }
  return slots;
}

export function LibraryAssetImageEditor({
  projectId,
  context,
  assetId,
  assetKind,
  assetName,
  initialMediaId,
  existingMediaIds,
  initialPrompt = "",
  setPrimaryOnSave = true,
  onClose,
  onSaved,
}: Props) {
  const [currentMediaId, setCurrentMediaId] = useState<string | null>(
    initialMediaId,
  );
  const [historyIds, setHistoryIds] = useState<string[]>(existingMediaIds);
  const [showHistory, setShowHistory] = useState(existingMediaIds.length > 1);
  const [referenceSlots, setReferenceSlots] = useState<
    AssetImageEditReferenceSlot[]
  >(() => makeInitialSlots(projectId, initialMediaId, context));
  const [prompt, setPrompt] = useState(initialPrompt);
  const [imageOptions, setImageOptions] = useState<DesignImageGenerationOptions>(
    DEFAULT_DESIGN_IMAGE_OPTIONS,
  );
  const [imageModelId, setImageModelId] = useState<DesignImageModelId>(
    DEFAULT_DESIGN_IMAGE_MODEL_ID,
  );
  const [generateBusy, setGenerateBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedMediaIds, setSavedMediaIds] = useState<Set<string>>(
    () => new Set(existingMediaIds),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    prompt?: boolean;
    referenceImages?: boolean;
  }>({});
  const referenceSlotsRef = useRef(referenceSlots);
  const lastGenerateFormRef = useRef<FormData | null>(null);

  const imageJob = useLibraryImageGenerationJob({
    projectId,
    context,
    assetId,
    assetKind,
  });

  useEffect(() => {
    const job = imageJob.job;
    if (!job?.primaryMediaId) return;
    if (job.status !== "succeeded" && job.status !== "save_failed") return;
    setCurrentMediaId(job.primaryMediaId);
    setHistoryIds((previous) =>
      previous.includes(job.primaryMediaId!)
        ? previous
        : [...previous, ...job.mediaIds.filter((id) => !previous.includes(id))],
    );
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

  useEffect(() => {
    referenceSlotsRef.current = referenceSlots;
  }, [referenceSlots]);

  useEffect(
    () => () => revokeAssetImageEditSlots(referenceSlotsRef.current),
    [],
  );

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
  const previewUrl = useMemo(
    () =>
      currentMediaId
        ? getProjectAssetImageUrl(projectId, currentMediaId, {
            revision: currentMediaId,
            context,
          })
        : null,
    [currentMediaId, projectId, context],
  );
  const canGenerate =
    Boolean(prompt.trim()) &&
    referenceSlots.some(Boolean) &&
    !generateBusy &&
    !saveBusy &&
    !imageJob.generationBlocked;
  const saved = Boolean(currentMediaId && savedMediaIds.has(currentMediaId));

  const buildGenerateForm = useCallback(() => {
    const form = new FormData();
    form.set("assetId", assetId);
    form.set("assetKind", assetKind);
    form.set("mode", "image_to_image");
    form.set("model", imageModelId);
    form.set("prompt", prompt.trim());
    form.set("idempotencyKey", safeRandomUUID());
    form.set("quality", imageOptions.quality);
    form.set("aspectRatio", imageOptions.aspectRatio);
    form.set("count", String(imageOptions.count));
    referenceSlots.forEach((slot, index) => {
      if (!slot) return;
      if (slot.source === "asset-media") {
        form.set(`referenceMediaId[${index}]`, slot.mediaId);
      } else if (slot.source === "upload") {
        form.set(`referenceImage[${index}]`, slot.file);
      }
    });
    return form;
  }, [assetId, assetKind, imageModelId, imageOptions, prompt, referenceSlots]);

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
    setGenerateBusy(true);
    setError("");
    setNotice("");
    setFieldErrors({});
    imageJob.setServiceNotice("");
    try {
      const form = buildGenerateForm();
      form.set("sourceEntry", "library_image");
      lastGenerateFormRef.current = form;

      const response = await fetch(`${apiRoot}/assets-draft/media/generate`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        async?: boolean;
        jobId?: string;
        job?: Parameters<typeof imageJob.beginFromGenerateResponse>[0]["job"];
        mediaId?: string;
        mediaIds?: string[];
        notice?: string;
      };
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
        throw new Error(payload.error ?? "图片编辑失败");
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
      const nextMediaId = mediaIds[0];
      if (!nextMediaId) throw new Error("生成结果中没有图片");
      setCurrentMediaId(nextMediaId);
      setHistoryIds((previous) => [
        ...previous,
        ...mediaIds.filter((mediaId) => !previous.includes(mediaId)),
      ]);
      setShowHistory(true);
      setNotice(payload.notice ?? `已生成 ${mediaIds.length} 张图片`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片编辑失败");
    } finally {
      if (!imageJob.generationBlocked) setGenerateBusy(false);
    }
  }, [apiRoot, buildGenerateForm, canGenerate, imageJob]);

  const handleSave = useCallback(async () => {
    if (!currentMediaId || saved) return;
    setSaveBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiRoot}/assets-draft/media/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          assetKind,
          mediaId: currentMediaId,
          setPrimary: setPrimaryOnSave,
        }),
      });
      const payload = (await response.json()) as LibraryAssetImageSaveResult & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "保存图片失败");

      setSavedMediaIds((previous) => new Set(previous).add(currentMediaId));
      await imageJob.markSaved();
      onSaved(payload);
      setNotice("图片已保存到当前资产");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "保存图片失败";
      setError(message);
      await imageJob.markSaveFailed(message);
    } finally {
      setSaveBusy(false);
    }
  }, [
    apiRoot,
    assetId,
    assetKind,
    currentMediaId,
    imageJob,
    onSaved,
    saved,
    setPrimaryOnSave,
  ]);

  const editorTitle =
    assetKind === "scene"
      ? `场景编辑 · ${assetName}`
      : assetKind === "prop"
        ? `道具编辑 · ${assetName}`
        : `编辑图片 · ${assetName}`;

  return (
    <>
      <AssetImageEditPanel
        title={editorTitle}
        previewUrl={previewUrl}
        historyIds={historyIds}
        currentMediaId={currentMediaId}
        historyThumbUrl={(mediaId) =>
          getProjectAssetImageUrl(projectId, mediaId, {
            revision: mediaId,
            context,
          })
        }
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory((visible) => !visible)}
        onSelectHistory={setCurrentMediaId}
        referenceSlots={referenceSlots}
        onReferenceSlotsChange={setReferenceSlots}
        imageEditPrompt={prompt}
        onImageEditPromptChange={setPrompt}
        imageOptions={imageOptions}
        onImageOptionsChange={setImageOptions}
        imageModelId={imageModelId}
        onImageModelIdChange={setImageModelId}
        generateBusy={generateBusy || imageJob.generationBlocked}
        saveBusy={saveBusy}
        saved={saved}
        canGenerate={canGenerate || imageJob.canRetry}
        canSave={Boolean(currentMediaId)}
        fieldErrors={fieldErrors}
        error={error}
        notice={notice || imageJob.serviceNotice}
        onGenerate={() => void handleGenerate()}
        onSave={() => void handleSave()}
        onClose={onClose}
      />
      <ImageGenerationTaskPanel
        projectId={projectId}
        context={context}
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
    </>
  );
}
