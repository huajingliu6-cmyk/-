"use client";

import { useCallback, useState, type MutableRefObject } from "react";
import {
  AssetCompactList,
  AssetListPanelHeader,
} from "@/projects/assets/AssetCompactList";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
import { PropCreateDialog } from "@/projects/assets/PropCreateDialog";
import { PropDetail } from "@/projects/assets/PropDetail";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import { derivePropStatus, propDisplayStatus } from "@/projects/assets/status";
import { createLibraryProp } from "@/projects/assets/create-library-asset-client";
import { deleteLibraryAssetClient } from "@/projects/assets/delete-library-asset-client";
import { AssetDeleteInUseDialog } from "@/projects/assets/AssetDeleteInUseDialog";
import type { AssetReferenceImpact } from "@/projects/assets/asset-reference-impact-types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { PropAsset, PropDraftInput } from "@/projects/assets/types";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  props: PropAsset[];
  canEdit: boolean;
  onChange: (next: PropAsset[]) => void;
  onPersist: (next: PropAsset[]) => Promise<void>;
  designItems?: EpisodeAssetDesignItem[];
  designEpisodeId?: string;
  onDesignItemChange?: (item: EpisodeAssetDesignItem) => void;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: MutableRefObject<(() => Promise<void>) | null>;
};

export function PropManager({
  projectId,
  context = "management",
  props: propItems,
  canEdit,
  onChange,
  onPersist,
  designItems,
  designEpisodeId,
  onDesignItemChange,
  onPromptDirtyChange,
  promptFlushRef,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    propItems[0]?.id ?? null,
  );
  const [promptDirty, setPromptDirty] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>(
    {},
  );
  const [inUseDialog, setInUseDialog] = useState<{
    assetId: string;
    assetName: string;
    impact: AssetReferenceImpact;
  } | null>(null);
  const [inUseBusy, setInUseBusy] = useState(false);
  const selected = propItems.find((p) => p.id === selectedId) ?? null;

  const handlePromptDirtyChange = useCallback(
    (dirty: boolean) => {
      setPromptDirty(dirty);
      onPromptDirtyChange?.(dirty);
    },
    [onPromptDirtyChange],
  );

  const requestSelect = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (promptDirty) {
        setPendingSelectId(id);
        return;
      }
      setSelectedId(id);
    },
    [promptDirty, selectedId],
  );

  const completePendingSelect = useCallback((id: string) => {
    setPendingSelectId(null);
    setPromptDirty(false);
    setSelectedId(id);
  }, []);

  const handleUnsavedSave = useCallback(async () => {
    setUnsavedBusy(true);
    try {
      await promptFlushRef?.current?.();
      if (pendingSelectId) completePendingSelect(pendingSelectId);
    } finally {
      setUnsavedBusy(false);
    }
  }, [completePendingSelect, pendingSelectId, promptFlushRef]);

  const handleUnsavedDiscard = useCallback(() => {
    if (pendingSelectId) completePendingSelect(pendingSelectId);
  }, [completePendingSelect, pendingSelectId]);

  const updateOne = (next: PropAsset) => {
    const withStatus = { ...next, status: derivePropStatus(next) };
    onChange(propItems.map((p) => (p.id === withStatus.id ? withStatus : p)));
  };

  const applyLocalDelete = (id: string) => {
    const deletedIndex = propItems.findIndex((item) => item.id === id);
    if (deletedIndex < 0) return;
    const next = propItems.filter((item) => item.id !== id);
    onChange(next);
    if (selectedId === id) {
      setSelectedId(next[Math.min(deletedIndex, next.length - 1)]?.id ?? null);
    }
    setImageRevisions((previous) => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
  };

  const handleDelete = async (id: string): Promise<"deleted" | "in_use"> => {
    const target = propItems.find((item) => item.id === id);
    if (!target) return "deleted";
    setNote("正在删除道具…");
    const outcome = await deleteLibraryAssetClient({
      projectId,
      context,
      kind: "prop",
      assetId: id,
      unlinkStoryboardRefs: false,
    });
    if (outcome.status === "in_use") {
      setInUseDialog({
        assetId: id,
        assetName: target.name || "未命名道具",
        impact: outcome.impact,
      });
      setNote(outcome.message);
      return "in_use";
    }
    if (outcome.status === "error") {
      setNote(outcome.message);
      throw new Error(outcome.message);
    }
    applyLocalDelete(id);
    setNote(
      outcome.unlinkedStoryboard
        ? "已解除分镜关联并删除道具。"
        : "已删除道具。",
    );
    return "deleted";
  };

  const handleUnlinkAndDelete = async () => {
    if (!inUseDialog) return;
    const id = inUseDialog.assetId;
    setInUseBusy(true);
    setNote("正在解除关联并删除道具…");
    try {
      const outcome = await deleteLibraryAssetClient({
        projectId,
        context,
        kind: "prop",
        assetId: id,
        unlinkStoryboardRefs: true,
      });
      if (outcome.status !== "deleted") {
        setNote(outcome.message);
        return;
      }
      applyLocalDelete(id);
      setInUseDialog(null);
      setNote("已解除分镜关联并删除道具。");
    } finally {
      setInUseBusy(false);
    }
  };

  const handleDialogSubmit = (draft: PropDraftInput) => {
    if (!draft.pendingImageFile) {
      setNote("请先上传道具图片后再创建");
      return;
    }
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
    setCreateOpen(false);
    setNote("正在创建道具…");
    void (async () => {
      try {
        const created = await createLibraryProp({
          projectId,
          context,
          draft,
        });
        const next = [...propItems, created];
        onChange(next);
        setSelectedId(created.id);
        setImageRevisions((previous) => ({
          ...previous,
          [created.id]: (previous[created.id] ?? 0) + 1,
        }));
        setNote("已创建并保存道具图片。");
      } catch (error) {
        setNote(error instanceof Error ? error.message : "保存失败");
      }
    })();
  };

  return (
    <>
      <AssetLibraryLayout
        listLabel="道具列表"
        listHeader={
          <AssetListPanelHeader
            title="道具列表"
            action={
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={!canEdit}
                onClick={() => setCreateOpen(true)}
              >
                + 新建道具
              </button>
            }
          />
        }
        list={
          <AssetCompactList
            projectId={projectId}
            context={context}
            selectedId={selectedId}
            onSelect={requestSelect}
            onDelete={canEdit ? handleDelete : undefined}
            emptyMessage="暂无道具资产。"
            testId="prop-compact-list"
            items={propItems.map((p) => {
              const status = propDisplayStatus(p);
              return {
                id: p.id,
                name: p.name || "未命名道具",
                status,
                warn: status === "待完善" || status === "草稿",
                placeholder: p.name.trim().slice(0, 1) || "道",
                asset: p,
                revision: imageRevisions[p.id] ?? 0,
              };
            })}
          />
        }
        details={
          <PropDetail
            key={selected?.id ?? "none"}
            projectId={projectId}
            context={context}
            prop={selected}
            canEdit={canEdit}
            imageRevision={selected ? (imageRevisions[selected.id] ?? 0) : 0}
            onChange={updateOne}
            onImageRevision={(assetId, next) =>
              setImageRevisions((prev) => ({ ...prev, [assetId]: next }))
            }
            onPersist={async (nextProp) => {
              const list = nextProp
                ? propItems.map((item) => {
                    const withStatus = {
                      ...nextProp,
                      status: derivePropStatus(nextProp),
                    };
                    return item.id === withStatus.id ? withStatus : item;
                  })
                : propItems;
              await onPersist(list);
            }}
            designItems={designItems}
            designEpisodeId={designEpisodeId}
            onDesignItemChange={onDesignItemChange}
            onPromptDirtyChange={handlePromptDirtyChange}
            promptFlushRef={promptFlushRef}
            onStatus={setNote}
            footer={note ? <p className="amw-note">{note}</p> : null}
          />
        }
      />

      <PropCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleDialogSubmit}
      />

      <AssetDeleteInUseDialog
        open={Boolean(inUseDialog)}
        assetName={inUseDialog?.assetName ?? ""}
        impact={inUseDialog?.impact ?? null}
        busy={inUseBusy}
        onCancel={() => setInUseDialog(null)}
        onUnlinkAndDelete={() => void handleUnlinkAndDelete()}
      />

      <UnsavedPromptDialog
        open={pendingSelectId != null}
        busy={unsavedBusy}
        onSave={() => void handleUnsavedSave()}
        onDiscard={handleUnsavedDiscard}
        onCancel={() => setPendingSelectId(null)}
      />
    </>
  );
}
