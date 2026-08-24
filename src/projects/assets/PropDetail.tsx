"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";
import { AssetDetailImage } from "@/projects/assets/AssetDetailImage";
import { AssetDetailLayout } from "@/projects/assets/AssetDetailLayout";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import {
  getProjectAssetImageUrl,
  resolveAssetImageSrc,
} from "@/projects/assets/asset-image-url";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  findLibraryDesignItem,
  type LibraryPromptAsset,
} from "@/projects/assets/library-asset-prompt";
import {
  addLibraryVariantDraft,
  buildLibraryVariantGridItems,
  collectLibraryAssetVariantMediaIds,
  findLibraryVariantDraft,
  removeLibraryVariantDraft,
  resolveLibraryAssetPrimaryMediaId,
  updateLibraryVariantDraftLabel,
  updateLibraryVariantDraftPrompt,
  withLibraryVariantLabel,
  withoutLibraryVariantMedia,
} from "@/projects/assets/library-asset-media-variants";
import { LibraryAssetMediaGrid } from "@/projects/assets/LibraryAssetMediaGrid";
import { LibraryAssetMediaLightbox } from "@/projects/assets/LibraryAssetMediaLightbox";
import { LibraryAssetPromptPanel } from "@/projects/assets/LibraryAssetPromptModal";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  buildProjectAssetMediaDragPayload,
  projectAssetMediaDragProps,
} from "@/projects/assets/project-asset-media-drag";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import { propDisplayStatus } from "@/projects/assets/status";
import type { PropAsset } from "@/projects/assets/types";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  prop: PropAsset | null;
  canEdit: boolean;
  imageRevision?: number;
  onChange: (next: PropAsset) => void;
  onImageRevision?: (assetId: string, next: number) => void;
  onPersist: () => Promise<void>;
  designItems?: EpisodeAssetDesignItem[];
  designEpisodeId?: string;
  onDesignItemChange?: (item: EpisodeAssetDesignItem) => void;
  onStatus?: (message: string) => void;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  footer?: React.ReactNode;
};

export function PropDetail({
  projectId,
  context = "management",
  prop,
  canEdit,
  imageRevision = 0,
  onChange,
  onImageRevision,
  onPersist,
  designItems,
  designEpisodeId,
  onDesignItemChange,
  onStatus,
  onPromptDirtyChange,
  promptFlushRef,
  footer,
}: Props) {
  const [heroMediaId, setHeroMediaId] = useState<string | null>(null);
  const [lightboxMediaId, setLightboxMediaId] = useState<string | null>(null);
  const [deleteConfirmMediaId, setDeleteConfirmMediaId] = useState<
    string | null
  >(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [activeVariantSlotId, setActiveVariantSlotId] = useState<string | null>(
    null,
  );
  const [promptDirty, setPromptDirty] = useState(false);
  const [pendingVariantAction, setPendingVariantAction] = useState<
    (() => void) | null
  >(null);
  const [scopeUnsavedBusy, setScopeUnsavedBusy] = useState(false);

  const handlePromptDirtyChange = (dirty: boolean) => {
    setPromptDirty(dirty);
    onPromptDirtyChange?.(dirty);
  };

  const runWithPromptGuard = (action: () => void) => {
    if (!promptDirty) {
      action();
      return;
    }
    setPendingVariantAction(() => action);
  };

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    setHeroMediaId(null);
    setActiveVariantSlotId(null);
    setDeleteConfirmMediaId(null);
  }, [prop?.id]);

  const designItem = prop
    ? findLibraryDesignItem(prop as LibraryPromptAsset, designItems)
    : null;

  const pendingMediaIds = useMemo(() => {
    const ids: string[] = [];
    const current = designItem?.generatedMedia?.currentId?.trim();
    if (current) ids.push(current);
    for (const id of designItem?.generatedMedia?.historyIds ?? []) {
      if (id?.trim()) ids.push(id.trim());
    }
    if (heroMediaId) ids.push(heroMediaId);
    return ids;
  }, [designItem, heroMediaId]);

  const { primaryMediaId, variantMediaIds } = useMemo(
    () =>
      prop
        ? collectLibraryAssetVariantMediaIds(prop, pendingMediaIds)
        : { primaryMediaId: null, variantMediaIds: [] },
    [pendingMediaIds, prop],
  );

  const variantItems = useMemo(
    () =>
      prop
        ? buildLibraryVariantGridItems(prop, variantMediaIds, "prop")
        : [],
    [prop, variantMediaIds],
  );

  const activeDraft = prop
    ? findLibraryVariantDraft(prop, activeVariantSlotId)
    : null;

  const effectiveHeroMediaId =
    heroMediaId ?? primaryMediaId ?? prop?.imageFileName ?? null;

  const previewSrc = useMemo(() => {
    if (!prop) return null;
    if (effectiveHeroMediaId) {
      return getProjectAssetImageUrl(projectId, effectiveHeroMediaId, {
        revision: effectiveHeroMediaId,
        context,
      });
    }
    return resolveAssetImageSrc(projectId, prop, {
      revision: imageRevision,
      context,
    });
  }, [context, effectiveHeroMediaId, imageRevision, projectId, prop]);

  const heroDragPayload = useMemo(
    () =>
      effectiveHeroMediaId
        ? buildProjectAssetMediaDragPayload({
            projectId,
            context,
            mediaId: effectiveHeroMediaId,
            label: `${prop?.name ?? "道具"} · 主道具`,
          })
        : null,
    [context, effectiveHeroMediaId, projectId, prop?.name],
  );

  const applySavedMedia = useCallback(
    (payload: {
      approvedMediaIds?: string[];
      primaryMediaId?: string | null;
      mediaId?: string;
    }) => {
      if (!prop) return;
      onChange({
        ...prop,
        ...(payload.approvedMediaIds
          ? { approvedMediaIds: payload.approvedMediaIds }
          : {}),
        ...(payload.primaryMediaId !== undefined
          ? { primaryMediaId: payload.primaryMediaId }
          : {}),
        ...(payload.primaryMediaId && payload.mediaId === payload.primaryMediaId
          ? {
              imageFileName: payload.mediaId,
              imageObjectUrl: null,
            }
          : {}),
      });
    },
    [onChange, prop],
  );

  const persistMediaToLibrary = useCallback(
    async (mediaId: string, setPrimary = false) => {
      if (!prop || !canEdit) return;
      setMediaBusy(true);
      try {
        await onPersist();
        const response = await fetch(`${apiRoot}/assets-draft/media/save`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: prop.id,
            assetKind: "prop",
            mediaId,
            setPrimary,
          }),
        });
        const payload = await parseResponseJson<{
          error?: string;
          approvedMediaIds?: string[];
          primaryMediaId?: string | null;
          mediaId?: string;
        }>(response);
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "保存道具图片失败");
        }
        applySavedMedia({
          approvedMediaIds: payload.approvedMediaIds,
          primaryMediaId: payload.primaryMediaId,
          mediaId: payload.mediaId ?? mediaId,
        });
        setHeroMediaId(setPrimary ? payload.primaryMediaId ?? mediaId : mediaId);
        onImageRevision?.(prop.id, imageRevision + 1);
      } finally {
        setMediaBusy(false);
      }
    },
    [
      apiRoot,
      applySavedMedia,
      canEdit,
      imageRevision,
      onImageRevision,
      onPersist,
      prop,
    ],
  );

  const addDraftVariant = () => {
    if (!prop || !canEdit || mediaBusy) return;
    const { asset: next, draft } = addLibraryVariantDraft(prop, "prop");
    onChange(next);
    setActiveVariantSlotId(draft.id);
    setHeroMediaId(null);
    setLightboxMediaId(null);
  };

  const syncGeneratedPreview = useCallback(
    async (mediaId: string | null) => {
      if (!prop || !mediaId) return;
      const draft = findLibraryVariantDraft(prop, activeVariantSlotId);
      setHeroMediaId(mediaId);
      onImageRevision?.(prop.id, imageRevision + 1);
      try {
        await persistMediaToLibrary(mediaId, false);
        if (draft) {
          const withoutDraft = removeLibraryVariantDraft(prop, draft.id);
          const index = variantMediaIds.length + 1;
          onChange(
            withLibraryVariantLabel(
              withoutDraft,
              mediaId,
              draft.label,
              "prop",
              index,
            ),
          );
          setActiveVariantSlotId(mediaId);
          await onPersist();
        }
      } catch (error) {
        onStatus?.(
          error instanceof Error ? error.message : "保存道具编辑失败",
        );
      }
    },
    [
      activeVariantSlotId,
      imageRevision,
      onChange,
      onImageRevision,
      onPersist,
      onStatus,
      persistMediaToLibrary,
      prop,
      variantMediaIds.length,
    ],
  );

  const handleDesignItemChange = (item: EpisodeAssetDesignItem) => {
    void syncGeneratedPreview(item.generatedMedia?.currentId?.trim() || null);
    onDesignItemChange?.(item);
  };

  const promoteMedia = async (mediaId: string) => {
    if (!prop || !canEdit) return;
    try {
      await persistMediaToLibrary(mediaId, true);
      setLightboxMediaId(null);
      onStatus?.("已设为主道具图。");
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "设为主图失败");
    }
  };

  const deleteVariant = async (slotId: string) => {
    if (!prop || !canEdit) return;
    setMediaBusy(true);
    try {
      const next = withoutLibraryVariantMedia(prop, slotId);
      onChange(next);
      await onPersist();
      if (
        heroMediaId === slotId ||
        primaryMediaId === slotId ||
        activeVariantSlotId === slotId
      ) {
        setHeroMediaId(resolveLibraryAssetPrimaryMediaId(next));
        setActiveVariantSlotId(null);
      }
      setDeleteConfirmMediaId(null);
      onStatus?.("已删除道具编辑。");
    } finally {
      setMediaBusy(false);
    }
  };

  const variantPromptScopeKey = activeDraft
    ? `draft:${activeDraft.id}`
    : activeVariantSlotId
      ? `variant:${activeVariantSlotId}`
      : "primary";
  const variantPromptScopeText = activeDraft
    ? activeDraft.promptText ?? ""
    : null;

  if (!prop) {
    return (
      <AssetDetailLayout
        title="道具"
        aria-label="道具"
        className="prop-detail prop-detail--prompt-split"
        empty
        emptyMessage="选择或新建道具以编辑详情。"
        showControls={false}
        footer={footer}
      />
    );
  }

  return (
    <>
      <AssetDetailLayout
        title="道具"
        aria-label="道具"
        className="prop-detail prop-detail--prompt-split"
        showControls={false}
        status={<span className="amw-badge">{propDisplayStatus(prop)}</span>}
        footer={footer}
        preview={
          <div className="character-prompt-split" data-testid="prop-prompt-split">
            <div className="character-prompt-split__left">
              <div
                className="character-media-stage character-preview-pane"
                data-testid="prop-hero-stage"
              >
                <div
                  className="character-preview-pane__display project-asset-media-drag-source"
                  {...projectAssetMediaDragProps(heroDragPayload)}
                >
                  <AssetDetailImage
                    fill
                    src={previewSrc}
                    alt={prop.imageFileName ?? prop.name}
                    testId="prop-detail-image"
                    emptyIcon={<Package size={36} strokeWidth={1.5} />}
                  />
                </div>
                {canEdit ? (
                  <div className="asset-library-preview__overlay-actions">
                    <AssetImageUpload
                      id={`prop-image-${prop.id}`}
                      label="道具图片"
                      compact
                      replaceOnly
                      hidePreview
                      disabled={!canEdit || mediaBusy}
                      projectId={projectId}
                      context={context}
                      assetId={prop.id}
                      actionLabel="替换道具"
                      ensurePersisted={onPersist}
                      revision={imageRevision}
                      onRevisionChange={(next) =>
                        onImageRevision?.(prop.id, next)
                      }
                      value={{
                        fileName: prop.imageFileName,
                        objectUrl: prop.imageObjectUrl,
                        mimeType: prop.imageMimeType,
                      }}
                      onChange={(image) =>
                        onChange({
                          ...prop,
                          imageFileName: image.fileName,
                          imageObjectUrl: image.objectUrl,
                          imageMimeType: image.mimeType,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>

              <LibraryAssetMediaGrid
                projectId={projectId}
                context={context}
                testIdPrefix="prop"
                sectionTitle="道具编辑"
                mainBadge="主道具"
                variantBadge="编辑"
                addAriaLabel="新增道具编辑"
                primaryMediaId={primaryMediaId}
                variants={variantItems}
                canEdit={canEdit}
                busy={mediaBusy}
                heroMediaId={effectiveHeroMediaId}
                activeVariantSlotId={activeVariantSlotId}
                dragAssetName={prop.name || "道具"}
                onSelectMain={() => {
                  runWithPromptGuard(() => {
                    setActiveVariantSlotId(null);
                    setLightboxMediaId(null);
                    setHeroMediaId(primaryMediaId);
                  });
                }}
                onAdd={() => {
                  runWithPromptGuard(() => addDraftVariant());
                }}
                onOpenVariant={(slotId) => {
                  runWithPromptGuard(() => {
                    const draft = findLibraryVariantDraft(prop, slotId);
                    setActiveVariantSlotId(slotId);
                    if (draft) {
                      setHeroMediaId(null);
                      setLightboxMediaId(null);
                      return;
                    }
                    setLightboxMediaId(slotId);
                    setHeroMediaId(slotId);
                  });
                }}
                onRenameVariant={(slotId, label, previousLabel) => {
                  const trimmed = label.trim();
                  if (!trimmed || trimmed === previousLabel.trim()) return;
                  if (findLibraryVariantDraft(prop, slotId)) {
                    onChange(updateLibraryVariantDraftLabel(prop, slotId, trimmed));
                    return;
                  }
                  const index = variantMediaIds.indexOf(slotId);
                  onChange(
                    withLibraryVariantLabel(
                      prop,
                      slotId,
                      trimmed,
                      "prop",
                      index >= 0 ? index + 1 : 1,
                    ),
                  );
                }}
                onDeleteVariant={(slotId) => setDeleteConfirmMediaId(slotId)}
              />
            </div>

            <div className="character-prompt-split__right">
              <div className="character-prompt-split__prompt">
                <LibraryAssetPromptPanel
                  key={`${prop.id}:${variantPromptScopeKey}`}
                  projectId={projectId}
                  context={context}
                  episodeId={designEpisodeId}
                  kind="prop"
                  asset={prop as LibraryPromptAsset}
                  designItem={activeDraft ? null : designItem}
                  onItemChange={handleDesignItemChange}
                  onCurrentMediaChange={syncGeneratedPreview}
                  hideMediaToolbar
                  hidePromptSectionLabel
                  promptContextLabel="道具提示词"
                  promptScopeKey={variantPromptScopeKey}
                  promptScopeText={variantPromptScopeText}
                  onPromptScopePersist={
                    activeDraft
                      ? (text) => {
                          onChange(
                            updateLibraryVariantDraftPrompt(
                              prop,
                              activeDraft.id,
                              text,
                            ),
                          );
                        }
                      : undefined
                  }
                  onPromptDirtyChange={handlePromptDirtyChange}
                  promptFlushRef={promptFlushRef}
                  onStatus={onStatus}
                />
              </div>
            </div>
          </div>
        }
      />

      <LibraryAssetMediaLightbox
        open={Boolean(lightboxMediaId)}
        projectId={projectId}
        context={context}
        assetName={prop.name}
        mediaId={lightboxMediaId ?? ""}
        primaryMediaId={primaryMediaId}
        canEdit={canEdit}
        busy={mediaBusy}
        testIdPrefix="prop"
        promoteLabel="设为主道具"
        onClose={() => setLightboxMediaId(null)}
        onPromote={
          lightboxMediaId
            ? () => void promoteMedia(lightboxMediaId)
            : undefined
        }
        onStatus={onStatus}
      />

      {deleteConfirmMediaId ? (
        <div
          className="character-look-delete-dialog"
          data-testid="prop-variant-delete-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <p>确认删除该道具编辑？删除后不可恢复。</p>
          <div className="character-look-delete-dialog__actions">
            <button
              type="button"
              className="amw-btn"
              onClick={() => setDeleteConfirmMediaId(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="prop-variant-delete-confirm"
              disabled={mediaBusy}
              onClick={() => void deleteVariant(deleteConfirmMediaId)}
            >
              确认删除
            </button>
          </div>
        </div>
      ) : null}

      <UnsavedPromptDialog
        open={pendingVariantAction != null}
        busy={scopeUnsavedBusy}
        onSave={() => {
          setScopeUnsavedBusy(true);
          void (async () => {
            try {
              await promptFlushRef?.current?.();
              pendingVariantAction?.();
              setPendingVariantAction(null);
              setPromptDirty(false);
            } finally {
              setScopeUnsavedBusy(false);
            }
          })();
        }}
        onDiscard={() => {
          pendingVariantAction?.();
          setPendingVariantAction(null);
          setPromptDirty(false);
        }}
        onCancel={() => setPendingVariantAction(null)}
      />
    </>
  );
}