"use client";

import { useCallback, useState, type MutableRefObject } from "react";
import {
  AssetCompactList,
  AssetListPanelHeader,
} from "@/projects/assets/AssetCompactList";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
import { SceneCreateDialog } from "@/projects/assets/SceneCreateDialog";
import { SceneDetail } from "@/projects/assets/SceneDetail";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import { deriveSceneStatus, sceneDisplayStatus } from "@/projects/assets/status";
import { createLibraryScene } from "@/projects/assets/create-library-asset-client";
import { deleteLibraryAssetClient } from "@/projects/assets/delete-library-asset-client";
import { AssetDeleteInUseDialog } from "@/projects/assets/AssetDeleteInUseDialog";
import type { AssetReferenceImpact } from "@/projects/assets/asset-reference-impact-types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { SceneAsset, SceneDraftInput } from "@/projects/assets/types";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  scenes: SceneAsset[];
  canEdit: boolean;
  onChange: (next: SceneAsset[]) => void;
  onPersist: (next: SceneAsset[]) => Promise<void>;
  designItems?: EpisodeAssetDesignItem[];
  designEpisodeId?: string;
  onDesignItemChange?: (item: EpisodeAssetDesignItem) => void;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: MutableRefObject<(() => Promise<void>) | null>;
};

export function SceneManager({
  projectId,
  context = "management",
  scenes,
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
    scenes[0]?.id ?? null,
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

  const selected = scenes.find((s) => s.id === selectedId) ?? null;

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

  const updateOne = (next: SceneAsset) => {
    const withStatus = { ...next, status: deriveSceneStatus(next) };
    onChange(scenes.map((s) => (s.id === withStatus.id ? withStatus : s)));
  };

  const applyLocalDelete = (id: string) => {
    const deletedIndex = scenes.findIndex((scene) => scene.id === id);
    if (deletedIndex < 0) return;
    const next = scenes.filter((scene) => scene.id !== id);
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
    const target = scenes.find((scene) => scene.id === id);
    if (!target) return "deleted";
    setNote("正在删除场景…");
    const outcome = await deleteLibraryAssetClient({
      projectId,
      context,
      kind: "scene",
      assetId: id,
      unlinkStoryboardRefs: false,
    });
    if (outcome.status === "in_use") {
      setInUseDialog({
        assetId: id,
        assetName: target.name || "未命名场景",
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
        ? "已解除分镜关联并删除场景。"
        : "已删除场景。",
    );
    return "deleted";
  };

  const handleUnlinkAndDelete = async () => {
    if (!inUseDialog) return;
    const id = inUseDialog.assetId;
    setInUseBusy(true);
    setNote("正在解除关联并删除场景…");
    try {
      const outcome = await deleteLibraryAssetClient({
        projectId,
        context,
        kind: "scene",
        assetId: id,
        unlinkStoryboardRefs: true,
      });
      if (outcome.status !== "deleted") {
        setNote(outcome.message);
        return;
      }
      applyLocalDelete(id);
      setInUseDialog(null);
      setNote("已解除分镜关联并删除场景。");
    } finally {
      setInUseBusy(false);
    }
  };

  const handleDialogSubmit = (draft: SceneDraftInput) => {
    if (!draft.pendingImageFile) {
      setNote("请先上传场景图片后再创建");
      return;
    }
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
    setCreateOpen(false);
    setNote("正在创建场景…");
    void (async () => {
      try {
        const created = await createLibraryScene({
          projectId,
          context,
          draft,
        });
        const next = [...scenes, created];
        onChange(next);
        setSelectedId(created.id);
        setImageRevisions((previous) => ({
          ...previous,
          [created.id]: (previous[created.id] ?? 0) + 1,
        }));
        setNote("已创建并保存场景图片。");
      } catch (error) {
        setNote(error instanceof Error ? error.message : "保存失败");
      }
    })();
  };

  return (
    <>
      <AssetLibraryLayout
        listLabel="场景列表"
        listHeader={
          <AssetListPanelHeader
            title="场景列表"
            action={
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={!canEdit}
                onClick={() => setCreateOpen(true)}
              >
                + 新建场景
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
            emptyMessage="暂无场景资产。"
            testId="scene-compact-list"
            items={scenes.map((s) => {
              const status = sceneDisplayStatus(s);
              return {
                id: s.id,
                name: s.name || "未命名场景",
                status,
                warn: status === "待完善" || status === "草稿",
                placeholder: s.name.trim().slice(0, 1) || "景",
                asset: s,
                revision: imageRevisions[s.id] ?? 0,
              };
            })}
          />
        }
        details={
          <SceneDetail
            key={selected?.id ?? "none"}
            projectId={projectId}
            context={context}
            scene={selected}
            canEdit={canEdit}
            imageRevision={selected ? (imageRevisions[selected.id] ?? 0) : 0}
            onChange={updateOne}
            onImageRevision={(assetId, next) =>
              setImageRevisions((prev) => ({ ...prev, [assetId]: next }))
            }
            onPersist={async (nextScene) => {
              const list = nextScene
                ? scenes.map((item) => {
                    const withStatus = {
                      ...nextScene,
                      status: deriveSceneStatus(nextScene),
                    };
                    return item.id === withStatus.id ? withStatus : item;
                  })
                : scenes;
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

      <SceneCreateDialog
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
