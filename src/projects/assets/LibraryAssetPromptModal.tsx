"use client";

import { useRef, useState } from "react";
import { DesignAssetModal } from "@/projects/assets/DesignAssetModal";
import type { GeneratedMediaState, EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  makeLibraryDesignItem,
  type LibraryPromptAsset,
  type LibraryPromptAssetKind,
} from "@/projects/assets/library-asset-prompt";

type Props = {
  open: boolean;
  projectId: string;
  context: "management" | "workspace";
  episodeId?: string;
  asset: LibraryPromptAsset | null;
  kind: LibraryPromptAssetKind;
  designItem?: EpisodeAssetDesignItem | null;
  onClose: () => void;
  onItemChange?: (item: EpisodeAssetDesignItem) => void;
};

export function LibraryAssetPromptModal({
  open,
  projectId,
  context,
  episodeId = "__full_script__",
  asset,
  kind,
  designItem,
  onClose,
  onItemChange,
}: Props) {
  const [localItem, setLocalItem] = useState<EpisodeAssetDesignItem | null>(
    () => (asset ? makeLibraryDesignItem(asset, kind, designItem) : null),
  );
  const localItemRef = useRef(localItem);

  if (!open || !asset || !localItem) return null;

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
      key={`${localItem.id}:${asset.id}`}
      open
      item={localItem}
      projectId={projectId}
      episodeId={episodeId}
      surface={context === "workspace" ? "workspace" : "project_management"}
      hideImageEdit
      previewMode={projectId === "asset-fusion-preview"}
      onClose={onClose}
      onPromptUpdated={(itemId, promptText, meta) => {
        if (itemId !== localItemRef.current?.id) return;
        updateItem((current) => ({
          ...current,
          designPrompt: {
            status: "ready",
            text: promptText,
            generationId: meta?.generationId ?? current.designPrompt?.generationId ?? null,
            sourceFingerprint: current.designPrompt?.sourceFingerprint ?? null,
            generatedAt: current.designPrompt?.generatedAt ?? new Date().toISOString(),
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
