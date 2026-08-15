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

export type CharacterLookSaveResult = {
  mediaId: string;
  approvedMediaIds: string[];
  primaryMediaId: string | null;
};

type Props = {
  projectId: string;
  context: "management" | "workspace";
  characterId: string;
  characterName: string;
  initialMediaId: string | null;
  existingMediaIds: string[];
  onClose: () => void;
  onSaved: (result: CharacterLookSaveResult) => void;
};

function makeInitialSlots(
  projectId: string,
  mediaId: string | null,
): AssetImageEditReferenceSlot[] {
  const slots = emptyAssetImageEditSlots();
  if (mediaId) {
    slots[0] = {
      source: "asset-media",
      mediaId,
      previewUrl: getProjectAssetImageUrl(projectId, mediaId, {
        revision: mediaId,
      }),
    };
  }
  return slots;
}

export function LibraryCharacterLookEditor({
  projectId,
  context,
  characterId,
  characterName,
  initialMediaId,
  existingMediaIds,
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
  >(() => makeInitialSlots(projectId, initialMediaId));
  const [prompt, setPrompt] = useState("");
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
  const referenceSlotsRef = useRef(referenceSlots);

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
          })
        : null,
    [currentMediaId, projectId],
  );
  const canGenerate =
    Boolean(prompt.trim()) && referenceSlots.some(Boolean) && !generateBusy;
  const saved = Boolean(
    currentMediaId && savedMediaIds.has(currentMediaId),
  );

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setGenerateBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("assetId", characterId);
      form.set("assetKind", "character");
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
        } else {
          form.set(`referenceImage[${index}]`, slot.file);
        }
      });

      const response = await fetch(`${apiRoot}/assets-draft/media/generate`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const payload = (await response.json()) as {
        error?: string;
        mediaId?: string;
        mediaIds?: string[];
        notice?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "生成造型失败");
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
      setReferenceSlots((previous) => {
        const next = [...previous];
        revokeAssetImageEditSlots([next[0] ?? null]);
        next[0] = {
          source: "asset-media",
          mediaId: nextMediaId,
          previewUrl: getProjectAssetImageUrl(projectId, nextMediaId, {
            revision: Date.now(),
          }),
        };
        return next;
      });
      setNotice(payload.notice ?? `已生成 ${mediaIds.length} 张造型`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成造型失败");
    } finally {
      setGenerateBusy(false);
    }
  }, [
    apiRoot,
    canGenerate,
    characterId,
    imageModelId,
    imageOptions,
    projectId,
    prompt,
    referenceSlots,
  ]);

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
          assetId: characterId,
          assetKind: "character",
          mediaId: currentMediaId,
          setPrimary: false,
        }),
      });
      const payload = (await response.json()) as CharacterLookSaveResult & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "保存造型失败");

      setSavedMediaIds((previous) =>
        new Set(previous).add(currentMediaId),
      );
      onSaved(payload);
      setNotice("新造型已保存到角色资产");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存造型失败");
    } finally {
      setSaveBusy(false);
    }
  }, [apiRoot, characterId, currentMediaId, onSaved, saved]);

  return (
    <AssetImageEditPanel
      title={`新增角色造型 · ${characterName}`}
      previewUrl={previewUrl}
      historyIds={historyIds}
      currentMediaId={currentMediaId}
      historyThumbUrl={(mediaId) =>
        getProjectAssetImageUrl(projectId, mediaId, { revision: mediaId })
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
      generateBusy={generateBusy}
      saveBusy={saveBusy}
      saved={saved}
      canGenerate={canGenerate}
      canSave={Boolean(currentMediaId)}
      error={error}
      notice={notice}
      onGenerate={() => void handleGenerate()}
      onSave={() => void handleSave()}
      onClose={onClose}
    />
  );
}
