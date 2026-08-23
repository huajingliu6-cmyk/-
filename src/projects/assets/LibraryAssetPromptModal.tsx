"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { DesignAssetModal } from "@/projects/assets/DesignAssetModal";
import type { AssetGenerationProgress } from "@/projects/assets/DesignGenerationOverlay";
import type {
  GeneratedMediaState,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";
import {
  makeLibraryDesignItem,
  type LibraryPromptAsset,
  type LibraryPromptAssetKind,
} from "@/projects/assets/library-asset-prompt";
import type { CharacterAsset } from "@/projects/assets/types";

type SharedProps = {
  projectId: string;
  context: "management" | "workspace";
  episodeId?: string;
  asset: LibraryPromptAsset | null;
  kind: LibraryPromptAssetKind;
  designItem?: EpisodeAssetDesignItem | null;
  onItemChange?: (item: EpisodeAssetDesignItem) => void;
  onCurrentMediaChange?: (mediaId: string | null) => void;
  /** Hide history/download/validation duplicates when host owns those controls. */
  hideMediaToolbar?: boolean;
  /** Hide embedded「素材提示词」label when host already shows object context. */
  hidePromptSectionLabel?: boolean;
  /** Object name shown in the prompt card header (主形象 / look name). */
  promptContextLabel?: string | null;
  /** Bubble status messages to the host toast channel. */
  onStatus?: (message: string) => void;
  /**
   * Forward DesignAssetModal generation progress so hosts that hide the
   * embedded preview (e.g. CharacterDetail hero) can overlay progress there.
   */
  onGenerationProgress?: (
    itemId: string,
    progress: AssetGenerationProgress | null,
  ) => void;
  /**
   * When set, soft-syncs embedded prompt textarea to this text without remounting
   * (e.g. switching character main vs appearance scope).
   */
  promptScopeKey?: string | null;
  promptScopeText?: string | null;
  /** Persist prompt edits for non-primary scopes (appearance promptOverride). */
  onPromptScopePersist?: (text: string) => void | Promise<void>;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: MutableRefObject<(() => Promise<void>) | null>;
};

type ModalProps = SharedProps & {
  open: boolean;
  onClose: () => void;
};

type PanelProps = SharedProps & {
  className?: string;
};

function assetSyncKey(
  asset: LibraryPromptAsset | null,
  kind: LibraryPromptAssetKind,
): string {
  if (!asset) return "";
  if (kind === "character") {
    const character = asset as CharacterAsset;
    return [
      character.id,
      character.primaryMediaId ?? "",
      (character.historyMediaIds ?? []).join(","),
      (character.lookMediaIds ?? []).join(","),
    ].join("|");
  }
  return `${asset.id}|${asset.primaryMediaId ?? ""}|${(asset.approvedMediaIds ?? []).join(",")}`;
}

function designSyncKey(designItem: EpisodeAssetDesignItem | null | undefined): string {
  if (!designItem) return "";
  return [
    designItem.id,
    designItem.generatedMedia?.currentId ?? "",
    (designItem.generatedMedia?.historyIds ?? []).join(","),
    designItem.designPrompt?.updatedAt ?? "",
    designItem.designPrompt?.text?.length ?? 0,
  ].join("|");
}

function LibraryAssetPromptSurface({
  mode,
  open = true,
  projectId,
  context,
  episodeId = "",
  asset,
  kind,
  designItem,
  onClose,
  onItemChange,
  onCurrentMediaChange,
  hideMediaToolbar = false,
  hidePromptSectionLabel = false,
  promptContextLabel = null,
  onStatus,
  onGenerationProgress,
  promptScopeKey = null,
  promptScopeText = null,
  onPromptScopePersist,
  onPromptDirtyChange,
  promptFlushRef,
}: SharedProps & {
  mode: "modal" | "embedded";
  open?: boolean;
  onClose?: () => void;
}) {
  const [localItem, setLocalItem] = useState<EpisodeAssetDesignItem | null>(
    () => (asset ? makeLibraryDesignItem(asset, kind, designItem) : null),
  );
  const localItemRef = useRef(localItem);
  const assetRef = useRef(asset);
  const designItemRef = useRef(designItem);
  assetRef.current = asset;
  designItemRef.current = designItem;

  const assetKey = assetSyncKey(asset, kind);
  const designKey = designSyncKey(designItem);

  useEffect(() => {
    localItemRef.current = localItem;
  }, [localItem]);

  // Soft-sync host asset/designItem without remounting DesignAssetModal.
  // Remount after generate reloads the preview blob and resets textarea scroll.
  useEffect(() => {
    const currentAsset = assetRef.current;
    if (!currentAsset) {
      setLocalItem(null);
      return;
    }
    const next = makeLibraryDesignItem(
      currentAsset,
      kind,
      designItemRef.current,
    );
    setLocalItem((previous) => {
      if (!previous) return next;
      const prevCurrent = previous.generatedMedia?.currentId ?? null;
      const nextCurrent = next.generatedMedia?.currentId ?? null;
      const keepLocalMedia =
        Boolean(prevCurrent) &&
        (prevCurrent === nextCurrent || !nextCurrent);
      const prevPrompt = previous.designPrompt?.text?.trim() ?? "";
      const nextPrompt = next.designPrompt?.text?.trim() ?? "";
      const keepLocalPrompt =
        prevPrompt.length > 0 &&
        (prevPrompt === nextPrompt || prevPrompt.length >= nextPrompt.length);
      if (
        previous.id === next.id &&
        keepLocalMedia &&
        keepLocalPrompt &&
        prevCurrent === (keepLocalMedia ? prevCurrent : nextCurrent)
      ) {
        return previous;
      }
      return {
        ...next,
        id: previous.id || next.id,
        generatedMedia: keepLocalMedia
          ? previous.generatedMedia
          : next.generatedMedia,
        designPrompt: keepLocalPrompt
          ? previous.designPrompt ?? next.designPrompt
          : next.designPrompt,
      } as EpisodeAssetDesignItem;
    });
  }, [assetKey, designKey, kind]);

  useEffect(() => {
    if (!promptScopeKey) return;
    setLocalItem((previous) => {
      if (!previous) return previous;
      const currentAsset = assetRef.current;
      if (!currentAsset) return previous;

      let nextText: string | null = null;
      if (promptScopeKey === "primary") {
        nextText =
          promptScopeText ??
          makeLibraryDesignItem(
            currentAsset,
            kind,
            designItemRef.current,
          ).designPrompt?.text ??
          "";
      } else if (promptScopeText != null) {
        nextText = promptScopeText;
      } else {
        return previous;
      }

      const currentText = previous.designPrompt?.text ?? "";
      if (currentText === nextText) return previous;
      return {
        ...previous,
        designPrompt: {
          ...(previous.designPrompt ?? {
            status: "ready" as const,
            generationId: null,
            sourceFingerprint: null,
            generatedAt: null,
            updatedAt: null,
            errorMessage: null,
            history: [],
          }),
          status: "ready" as const,
          text: nextText,
          updatedAt: new Date().toISOString(),
        },
      } as EpisodeAssetDesignItem;
    });
  }, [promptScopeKey, promptScopeText, kind]);

  if (mode === "modal" && !open) return null;
  if (!asset || !localItem) return null;

  const updateItem = (
    update:
      | EpisodeAssetDesignItem
      | ((current: EpisodeAssetDesignItem) => EpisodeAssetDesignItem),
  ) => {
    const current = localItemRef.current;
    if (!current) return;
    const next = typeof update === "function" ? update(current) : update;
    localItemRef.current = next;
    setLocalItem(next);
    onItemChange?.(next);
  };

  return (
    <DesignAssetModal
      key={`${asset.id}:${mode}`}
      open
      item={localItem}
      projectId={projectId}
      episodeId={episodeId}
      surface={context === "workspace" ? "workspace" : "project_management"}
      hideImageEdit
      hideMediaToolbar={hideMediaToolbar}
      hidePromptSectionLabel={hidePromptSectionLabel}
      promptContextLabel={promptContextLabel}
      onStatus={onStatus}
      onGenerationProgress={onGenerationProgress}
      variant={mode}
      onClose={onClose ?? (() => undefined)}
      onCurrentMediaChange={onCurrentMediaChange}
      onPromptDirtyChange={onPromptDirtyChange}
      promptFlushRef={promptFlushRef}
      onPromptUpdated={async (itemId, promptTextValue, meta) => {
        if (itemId !== localItemRef.current?.id) return;
        if (promptScopeKey && promptScopeKey !== "primary" && onPromptScopePersist) {
          await onPromptScopePersist(promptTextValue);
        }
        updateItem((current) => ({
          ...current,
          designPrompt: {
            status: "ready",
            text: promptTextValue,
            generationId:
              meta?.generationId ?? current.designPrompt?.generationId ?? null,
            sourceFingerprint:
              current.designPrompt?.sourceFingerprint ?? null,
            generatedAt:
              current.designPrompt?.generatedAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            errorMessage: null,
            history: meta?.history ?? current.designPrompt?.history ?? [],
          },
        }));
      }}
      onAssetGenerated={(itemId, media) => {
        if (itemId !== localItemRef.current?.id || !media) return;
        updateItem((current) => ({
          ...current,
          generatedMedia: media as GeneratedMediaState,
        }));
      }}
      onItemPatched={(itemId, next) => {
        if (itemId !== localItemRef.current?.id) return;
        updateItem(next);
      }}
    />
  );
}

export function LibraryAssetPromptModal({
  open,
  onClose,
  ...rest
}: ModalProps) {
  return (
    <LibraryAssetPromptSurface
      mode="modal"
      open={open}
      onClose={onClose}
      {...rest}
    />
  );
}

export function LibraryAssetPromptPanel({
  className,
  ...rest
}: PanelProps) {
  // Stable per asset — do not remount when a designItem id is linked after generate.
  const remountKey = rest.asset?.id ?? "none";
  return (
    <div className={className} data-testid="library-asset-prompt-panel">
      <LibraryAssetPromptSurface
        key={remountKey}
        mode="embedded"
        {...rest}
      />
    </div>
  );
}
