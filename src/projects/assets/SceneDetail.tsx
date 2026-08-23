"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned } from "lucide-react";
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
  collectLibraryAssetVariantMediaIds,
  resolveLibraryAssetPrimaryMediaId,
  resolveLibraryVariantLabel,
  withLibraryVariantLabel,
  withoutLibraryVariantMedia,
} from "@/projects/assets/library-asset-media-variants";
import { LibraryAssetImageEditor } from "@/projects/assets/LibraryAssetImageEditor";
import type { LibraryAssetImageSaveResult } from "@/projects/assets/LibraryAssetImageEditor";
import { LibraryAssetMediaGrid } from "@/projects/assets/LibraryAssetMediaGrid";
import { buildSceneVariantPromptPrefill } from "@/projects/assets/library-asset-variant-prefill";
import { LibraryAssetMediaLightbox } from "@/projects/assets/LibraryAssetMediaLightbox";
import { LibraryAssetPromptPanel } from "@/projects/assets/LibraryAssetPromptModal";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  buildProjectAssetMediaDragPayload,
  projectAssetMediaDragProps,
} from "@/projects/assets/project-asset-media-drag";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import { sceneDisplayStatus } from "@/projects/assets/status";
import type { SceneAsset } from "@/projects/assets/types";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  scene: SceneAsset | null;
  canEdit: boolean;
  imageRevision?: number;
  onChange: (next: SceneAsset) => void;
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

export function SceneDetail({
  projectId,
  context = "management",
  scene,
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
  const [variantEditorOpen, setVariantEditorOpen] = useState(false);
  const [variantEditorSession, setVariantEditorSession] = useState(0);
  const [variantEditorPrefill, setVariantEditorPrefill] = useState("");
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
    setLightboxMediaId(null);
    setDeleteConfirmMediaId(null);
    setVariantEditorOpen(false);
  }, [scene?.id]);

  const designItem = scene
    ? findLibraryDesignItem(scene as LibraryPromptAsset, designItems)
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
      scene
        ? collectLibraryAssetVariantMediaIds(scene, pendingMediaIds)
        : { primaryMediaId: null, variantMediaIds: [] },
    [pendingMediaIds, scene],
  );

  const variantItems = useMemo(
    () =>
      variantMediaIds.map((mediaId, index) => ({
        mediaId,
        label: scene
          ? resolveLibraryVariantLabel(scene, mediaId, index + 1, "scene")
          : mediaId,
      })),
    [scene, variantMediaIds],
  );

  const effectiveHeroMediaId =
    heroMediaId ?? primaryMediaId ?? scene?.imageFileName ?? null;

  const previewSrc = useMemo(() => {
    if (!scene) return null;
    if (effectiveHeroMediaId) {
      return getProjectAssetImageUrl(projectId, effectiveHeroMediaId, {
        revision: effectiveHeroMediaId,
        context,
      });
    }
    return resolveAssetImageSrc(projectId, scene, {
      revision: imageRevision,
      context,
    });
  }, [context, effectiveHeroMediaId, imageRevision, projectId, scene]);

  const heroDragPayload = useMemo(
    () =>
      effectiveHeroMediaId
        ? buildProjectAssetMediaDragPayload({
            projectId,
            context,
            mediaId: effectiveHeroMediaId,
            label: `${scene?.name ?? "场景"} · 主场景`,
          })
        : null,
    [context, effectiveHeroMediaId, projectId, scene?.name],
  );

  const applySavedMedia = useCallback(
    (payload: {
      approvedMediaIds?: string[];
      primaryMediaId?: string | null;
      mediaId?: string;
    }) => {
      if (!scene) return;
      onChange({
        ...scene,
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
    [onChange, scene],
  );

  const persistMediaToLibrary = useCallback(
    async (mediaId: string, setPrimary = false) => {
      if (!scene || !canEdit) return;
      setMediaBusy(true);
      try {
        await onPersist();
        const response = await fetch(`${apiRoot}/assets-draft/media/save`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: scene.id,
            assetKind: "scene",
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
          throw new Error(payload?.error ?? "保存场景图片失败");
        }
        applySavedMedia({
          approvedMediaIds: payload.approvedMediaIds,
          primaryMediaId: payload.primaryMediaId,
          mediaId: payload.mediaId ?? mediaId,
        });
        setHeroMediaId(setPrimary ? payload.primaryMediaId ?? mediaId : mediaId);
        onImageRevision?.(scene.id, imageRevision + 1);
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
      scene,
    ],
  );

  const existingMediaIds = useMemo(() => {
    const merged = [
      ...(scene?.approvedMediaIds ?? []),
      ...variantMediaIds,
      ...(primaryMediaId ? [primaryMediaId] : []),
    ];
    return merged.filter(
      (id, index) => id && merged.indexOf(id) === index,
    );
  }, [primaryMediaId, scene?.approvedMediaIds, variantMediaIds]);

  const openVariantEditor = () => {
    if (!scene || !canEdit || mediaBusy) return;
    setVariantEditorPrefill(buildSceneVariantPromptPrefill(scene));
    setVariantEditorSession((key) => key + 1);
    setVariantEditorOpen(true);
  };

  const handleVariantEditorSaved = (result: LibraryAssetImageSaveResult) => {
    if (!scene) return;
    applySavedMedia({
      approvedMediaIds: result.approvedMediaIds,
      primaryMediaId: result.primaryMediaId,
      mediaId: result.mediaId,
    });
    setHeroMediaId(result.mediaId);
    onImageRevision?.(scene.id, imageRevision + 1);
    setVariantEditorOpen(false);
      onStatus?.("已保存场景编辑。");
    void onPersist();
  };

  const syncGeneratedPreview = useCallback(
    (mediaId: string | null) => {
      if (!scene || !mediaId || variantEditorOpen) return;
      setHeroMediaId(mediaId);
      onImageRevision?.(scene.id, imageRevision + 1);
      void persistMediaToLibrary(mediaId, false).catch((error) => {
        onStatus?.(
          error instanceof Error ? error.message : "保存场景编辑失败",
        );
      });
    },
    [
      imageRevision,
      onImageRevision,
      onStatus,
      persistMediaToLibrary,
      scene,
      variantEditorOpen,
    ],
  );

  const handleDesignItemChange = (item: EpisodeAssetDesignItem) => {
    syncGeneratedPreview(item.generatedMedia?.currentId?.trim() || null);
    onDesignItemChange?.(item);
  };

  const promoteMedia = async (mediaId: string) => {
    if (!scene || !canEdit) return;
    try {
      await persistMediaToLibrary(mediaId, true);
      setLightboxMediaId(null);
      onStatus?.("已设为主场景图。");
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "设为主图失败");
    }
  };

  const deleteVariant = async (mediaId: string) => {
    if (!scene || !canEdit) return;
    setMediaBusy(true);
    try {
      const next = withoutLibraryVariantMedia(scene, mediaId);
      onChange(next);
      await onPersist();
      if (heroMediaId === mediaId || primaryMediaId === mediaId) {
        setHeroMediaId(resolveLibraryAssetPrimaryMediaId(next));
      }
      if (lightboxMediaId === mediaId) {
        setLightboxMediaId(null);
      }
      setDeleteConfirmMediaId(null);
      onStatus?.("已删除场景编辑。");
    } finally {
      setMediaBusy(false);
    }
  };

  if (!scene) {
    return (
      <AssetDetailLayout
        title="场景"
        aria-label="场景"
        className="scene-detail scene-detail--prompt-split"
        empty
        emptyMessage="选择或新建场景以编辑详情。"
        showControls={false}
        footer={footer}
      />
    );
  }

  return (
    <>
      <AssetDetailLayout
        title="场景"
        aria-label="场景"
        className="scene-detail scene-detail--prompt-split"
        showControls={false}
        status={<span className="amw-badge">{sceneDisplayStatus(scene)}</span>}
        footer={footer}
        preview={
          <div className="character-prompt-split" data-testid="scene-prompt-split">
            <div className="character-prompt-split__left">
              <div
                className="character-media-stage character-preview-pane"
                data-testid="scene-hero-stage"
              >
                <div
                  className="character-preview-pane__display project-asset-media-drag-source"
                  {...projectAssetMediaDragProps(heroDragPayload)}
                >
                  <AssetDetailImage
                    fill
                    src={previewSrc}
                    alt={scene.imageFileName ?? scene.name}
                    testId="scene-detail-image"
                    emptyIcon={<MapPinned size={36} strokeWidth={1.5} />}
                  />
                </div>
                {canEdit ? (
                  <div className="asset-library-preview__overlay-actions">
                    <AssetImageUpload
                      id={`scene-image-${scene.id}`}
                      label="场景图片"
                      compact
                      replaceOnly
                      hidePreview
                      disabled={!canEdit || mediaBusy}
                      projectId={projectId}
                      context={context}
                      assetId={scene.id}
                      actionLabel="替换场景"
                      ensurePersisted={onPersist}
                      revision={imageRevision}
                      onRevisionChange={(next) =>
                        onImageRevision?.(scene.id, next)
                      }
                      value={{
                        fileName: scene.imageFileName,
                        objectUrl: scene.imageObjectUrl,
                        mimeType: scene.imageMimeType,
                      }}
                      onChange={(image) =>
                        onChange({
                          ...scene,
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
                testIdPrefix="scene"
                sectionTitle="场景编辑"
                mainBadge="主场景"
                variantBadge="编辑"
                addAriaLabel="新增场景编辑"
                primaryMediaId={primaryMediaId}
                variants={variantItems}
                canEdit={canEdit}
                busy={mediaBusy}
                heroMediaId={effectiveHeroMediaId}
                lightboxMediaId={lightboxMediaId}
                dragAssetName={scene.name || "场景"}
                onSelectMain={() => {
                  runWithPromptGuard(() => {
                    setLightboxMediaId(null);
                    setHeroMediaId(primaryMediaId);
                  });
                }}
                onAdd={() => {
                  void onPersist().then(() => openVariantEditor());
                }}
                onOpenVariant={(mediaId) => {
                  runWithPromptGuard(() => {
                    setLightboxMediaId(mediaId);
                    setHeroMediaId(mediaId);
                  });
                }}
                onRenameVariant={(mediaId, label, previousLabel) => {
                  const trimmed = label.trim();
                  if (!trimmed || trimmed === previousLabel.trim()) return;
                  const index = variantMediaIds.indexOf(mediaId);
                  onChange(
                    withLibraryVariantLabel(
                      scene,
                      mediaId,
                      trimmed,
                      "scene",
                      index >= 0 ? index + 1 : 1,
                    ),
                  );
                }}
                onDeleteVariant={(mediaId) => setDeleteConfirmMediaId(mediaId)}
              />
            </div>

            <div className="character-prompt-split__right">
              <div className="character-prompt-split__prompt">
                <LibraryAssetPromptPanel
                  key={scene.id}
                  projectId={projectId}
                  context={context}
                  episodeId={designEpisodeId}
                  kind="scene"
                  asset={scene as LibraryPromptAsset}
                  designItem={designItem}
                  onItemChange={handleDesignItemChange}
                  onCurrentMediaChange={
                    variantEditorOpen ? undefined : syncGeneratedPreview
                  }
                  hideMediaToolbar
                  hidePromptSectionLabel
                  promptContextLabel="场景提示词"
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
        assetName={scene.name}
        mediaId={lightboxMediaId ?? ""}
        primaryMediaId={primaryMediaId}
        canEdit={canEdit}
        busy={mediaBusy}
        testIdPrefix="scene"
        promoteLabel="设为主场景"
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
          data-testid="scene-variant-delete-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <p>确认删除该场景编辑？删除后不可恢复。</p>
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
              data-testid="scene-variant-delete-confirm"
              disabled={mediaBusy}
              onClick={() => void deleteVariant(deleteConfirmMediaId)}
            >
              确认删除
            </button>
          </div>
        </div>
      ) : null}

      {variantEditorOpen ? (
        <LibraryAssetImageEditor
          key={`scene-variant-editor:${scene.id}:session:${variantEditorSession}`}
          projectId={projectId}
          context={context}
          assetId={scene.id}
          assetKind="scene"
          assetName={scene.name || "未命名场景"}
          initialMediaId={primaryMediaId}
          existingMediaIds={existingMediaIds}
          initialPrompt={variantEditorPrefill}
          setPrimaryOnSave={false}
          onClose={() => setVariantEditorOpen(false)}
          onSaved={handleVariantEditorSaved}
        />
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
