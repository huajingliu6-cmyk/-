"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { CharacterList, CharacterListHeader } from "@/projects/assets/CharacterList";
import { CharacterDetail } from "@/projects/assets/CharacterDetail";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { CharacterCreateDialog } from "@/projects/assets/CharacterCreateDialog";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";
import {
  voiceOptionsFromAudios,
} from "@/projects/assets/voice-catalog";
import { deriveCharacterStatus } from "@/projects/assets/status";
import { createLibraryCharacter } from "@/projects/assets/create-library-asset-client";
import { deleteLibraryAssetClient } from "@/projects/assets/delete-library-asset-client";
import { AssetDeleteInUseDialog } from "@/projects/assets/AssetDeleteInUseDialog";
import type { AssetReferenceImpact } from "@/projects/assets/asset-reference-impact-types";
import type {
  AudioAsset,
  CharacterAsset,
  CharacterDraftInput,
} from "@/projects/assets/types";
import {
  AppToastHost,
  makeStatusPusher,
  useAppToasts,
} from "@/shell/AppToast";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  characters: CharacterAsset[];
  audios: AudioAsset[];
  canEdit: boolean;
  onChange: (next: CharacterAsset[]) => void;
  onPersist: (next: CharacterAsset[]) => Promise<void>;
  onAudiosChange?: (next: AudioAsset[]) => void;
  onPersistAudios?: (next: AudioAsset[]) => Promise<void>;
  designItems?: EpisodeAssetDesignItem[];
  designEpisodeId?: string;
  onDesignItemChange?: (item: EpisodeAssetDesignItem) => void;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: MutableRefObject<(() => Promise<void>) | null>;
};

export function CharacterManager({
  projectId,
  context = "management",
  characters,
  audios,
  canEdit,
  onChange,
  onPersist,
  onAudiosChange,
  onPersistAudios,
  designItems,
  designEpisodeId,
  onDesignItemChange,
  onPromptDirtyChange,
  promptFlushRef,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    characters[0]?.id ?? null,
  );
  const [promptDirty, setPromptDirty] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeMediaIds, setActiveMediaIds] = useState<
    Record<string, string | null>
  >({});
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();
  const setNote = useCallback(
    (message: string) => {
      makeStatusPusher(pushToast)(message);
    },
    [pushToast],
  );

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

  const handleActiveMediaChange = useCallback(
    (mediaId: string | null) => {
      if (!selectedId) return;
      setActiveMediaIds((previous) => {
        if (previous[selectedId] === mediaId) return previous;
        return { ...previous, [selectedId]: mediaId };
      });
    },
    [selectedId],
  );

  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>(
    {},
  );
  const [inUseDialog, setInUseDialog] = useState<{
    assetId: string;
    assetName: string;
    impact: AssetReferenceImpact;
  } | null>(null);
  const [inUseBusy, setInUseBusy] = useState(false);
  const charactersRef = useRef(characters);
  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  const projectVoices = voiceOptionsFromAudios(audios);
  const selected =
    characters.find((c) => c.id === selectedId) ?? characters[0] ?? null;

  const updateOne = (next: CharacterAsset) => {
    const updated = charactersRef.current.map((c) =>
      c.id === next.id ? next : c,
    );
    charactersRef.current = updated;
    onChange(updated);
  };

  const handleCreate = async (draft: CharacterDraftInput) => {
    if (!draft.pendingImageFile) {
      setNote("请先上传角色图片后再创建");
      return;
    }
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
    setCreateOpen(false);
    setNote("正在创建角色并校验…");
    try {
      const created = await createLibraryCharacter({
        projectId,
        context,
        draft,
        projectVoices,
      });
      const next = [...charactersRef.current, created];
      charactersRef.current = next;
      onChange(next);
      setSelectedId(created.id);
      setImageRevisions((prev) => ({
        ...prev,
        [created.id]: (prev[created.id] ?? 0) + 1,
      }));
      setNote("已新建角色。");
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "保存失败");
    }
  };

  const handleSave = (snapshot?: CharacterAsset) => {
    const base =
      snapshot ??
      charactersRef.current.find((c) => c.id === selectedId) ??
      selected;
    if (!base) return;
    const nextItem = {
      ...base,
      status: deriveCharacterStatus(base),
    };
    const next = charactersRef.current.map((c) =>
      c.id === nextItem.id ? nextItem : c,
    );
    charactersRef.current = next;
    onChange(next);
    setNote("正在保存角色…");
    void onPersist(next)
      .then(() => setNote("已保存角色到服务器。"))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "保存失败");
      });
  };

  const applyLocalDelete = (id: string) => {
    const current = charactersRef.current;
    const deletedIndex = current.findIndex((character) => character.id === id);
    if (deletedIndex < 0) return;
    const next = current.filter((character) => character.id !== id);
    charactersRef.current = next;
    onChange(next);
    if (selectedId === id) {
      setSelectedId(next[Math.min(deletedIndex, next.length - 1)]?.id ?? null);
    }
    setImageRevisions((previous) => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
    setActiveMediaIds((previous) => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
  };

  const handleDelete = async (id: string): Promise<"deleted" | "in_use"> => {
    const target = charactersRef.current.find((character) => character.id === id);
    if (!target) return "deleted";
    setNote("正在删除角色…");
    const outcome = await deleteLibraryAssetClient({
      projectId,
      context,
      kind: "character",
      assetId: id,
      unlinkStoryboardRefs: false,
    });
    if (outcome.status === "in_use") {
      setInUseDialog({
        assetId: id,
        assetName: target.name || "未命名角色",
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
        ? "已解除分镜关联并删除角色。"
        : "已删除角色。",
    );
    return "deleted";
  };

  const handleUnlinkAndDelete = async () => {
    if (!inUseDialog) return;
    const id = inUseDialog.assetId;
    setInUseBusy(true);
    setNote("正在解除关联并删除角色…");
    try {
      const outcome = await deleteLibraryAssetClient({
        projectId,
        context,
        kind: "character",
        assetId: id,
        unlinkStoryboardRefs: true,
      });
      if (outcome.status !== "deleted") {
        setNote(
          outcome.status === "in_use"
            ? outcome.message
            : outcome.message,
        );
        return;
      }
      applyLocalDelete(id);
      setInUseDialog(null);
      setNote("已解除分镜关联并删除角色。");
    } finally {
      setInUseBusy(false);
    }
  };

  const normalizeCharacterName = (name: string) =>
    name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

  const mergeCandidates = useMemo(() => {
    if (!mergeSourceId) return [] as CharacterAsset[];
    const source = characters.find((c) => c.id === mergeSourceId);
    if (!source) return [];
    const key = normalizeCharacterName(source.name);
    return characters.filter(
      (c) => c.id !== mergeSourceId && normalizeCharacterName(c.name) === key,
    );
  }, [characters, mergeSourceId]);

  const handleMergeRequest = async () => {
    const source = mergeSourceId
      ? charactersRef.current.find((c) => c.id === mergeSourceId)
      : null;
    const target = mergeTargetId
      ? charactersRef.current.find((c) => c.id === mergeTargetId)
      : null;
    if (!source || !target || source.id === target.id) {
      setNote("请先明确选择合并目标角色。");
      return;
    }
    if (
      normalizeCharacterName(source.name) !== normalizeCharacterName(target.name)
    ) {
      setNote("只有同名角色才可以合并造型");
      setMergeSourceId(null);
      setMergeTargetId(null);
      return;
    }
    setNote("正在处理合并请求…");
    try {
      const root =
        context === "workspace"
          ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
          : `/api/projects/${encodeURIComponent(projectId)}`;
      const response = await fetch(`${root}/assets-draft/characters/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetCharacterId: target.id,
          sourceCharacterId: source.id,
        }),
      });
      const payload = await parseResponseJson<{
        error?: string;
        submitted?: boolean;
        target?: CharacterAsset;
      }>(response);
      if (!response.ok || !payload) throw new Error(payload?.error ?? "合并失败");
      if (payload.target) {
        const next = charactersRef.current
          .filter((c) => c.id !== source.id)
          .map((c) => (c.id === target.id ? payload.target! : c));
        charactersRef.current = next;
        onChange(next);
        setSelectedId(target.id);
        setNote("已合并造型并迁移引用。");
      } else {
        setNote("已提交合并申请，等待项目主理人处理。");
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "合并失败");
    } finally {
      setMergeSourceId(null);
      setMergeTargetId(null);
    }
  };

  const clearVoiceRefsLocally = (voiceId: string) => {
    const next = charactersRef.current.map((character) => {
      const clearPrimary = character.voiceId === voiceId;
      let mediaVoices = character.mediaVoices;
      let mediaChanged = false;
      if (mediaVoices) {
        const cleaned: NonNullable<CharacterAsset["mediaVoices"]> = {};
        for (const [mediaId, entry] of Object.entries(mediaVoices)) {
          if (entry?.voiceId === voiceId) {
            mediaChanged = true;
            continue;
          }
          cleaned[mediaId] = entry;
        }
        mediaVoices = Object.keys(cleaned).length > 0 ? cleaned : undefined;
      }
      let appearances = character.appearances;
      let appearanceChanged = false;
      if (appearances) {
        appearances = appearances.map((item) => {
          if (item.voiceOverrideId !== voiceId) return item;
          appearanceChanged = true;
          return {
            ...item,
            voiceOverrideId: null,
            voiceOverrideName: null,
            revision: item.revision + 1,
          };
        });
      }
      if (!clearPrimary && !mediaChanged && !appearanceChanged) {
        return character;
      }
      return {
        ...character,
        ...(clearPrimary
          ? { voiceId: null, voiceName: null, voiceStyle: null }
          : {}),
        ...(mediaChanged ? { mediaVoices } : {}),
        ...(appearanceChanged ? { appearances } : {}),
      };
    });
    charactersRef.current = next;
    onChange(next);
  };

  return (
    <>
      <AssetLibraryLayout
        listLabel="角色列表"
        listHeader={
          <CharacterListHeader
            canEdit={canEdit}
            onCreate={() => setCreateOpen(true)}
          />
        }
        list={
          <CharacterList
            listOnly
            projectId={projectId}
            context={context}
            characters={characters}
            selectedId={selectedId}
            canEdit={canEdit}
            imageRevisions={imageRevisions}
            onSelect={requestSelect}
            onDelete={canEdit ? handleDelete : undefined}
            onCreate={() => setCreateOpen(true)}
          />
        }
        details={
          <CharacterDetail
            key={selected?.id ?? "none"}
            projectId={projectId}
            context={context}
            character={selected}
            canEdit={canEdit}
            projectVoices={projectVoices}
            audios={audios}
            onAudiosChange={onAudiosChange}
            onPersistAudios={onPersistAudios}
            onVoiceHardDeleted={clearVoiceRefsLocally}
            imageRevision={selected ? (imageRevisions[selected.id] ?? 0) : 0}
            controlledMediaId={
              selected ? (activeMediaIds[selected.id] ?? null) : null
            }
            onActiveMediaChange={handleActiveMediaChange}
            onChange={updateOne}
            onSave={handleSave}
            onPreviewStatus={setNote}
            onImageRevision={(assetId, next) =>
              setImageRevisions((prev) => ({ ...prev, [assetId]: next }))
            }
            ensurePersisted={async () => {
              await onPersist(charactersRef.current);
            }}
            designItems={designItems}
            designEpisodeId={designEpisodeId}
            onDesignItemChange={onDesignItemChange}
            onPromptDirtyChange={handlePromptDirtyChange}
            promptFlushRef={promptFlushRef}
            mergeAvailable={Boolean(
              selected &&
                characters.some(
                  (c) =>
                    c.id !== selected.id &&
                    normalizeCharacterName(c.name) ===
                      normalizeCharacterName(selected.name),
                ),
            )}
            onRequestMerge={
              selected
                ? () => {
                    setMergeSourceId(selected.id);
                    setMergeTargetId(null);
                    setNote("请在弹窗中明确选择合并目标角色。");
                  }
                : undefined
            }
          />
        }
      />
      <CharacterCreateDialog
        open={createOpen}
        projectVoices={projectVoices}
        onClose={() => setCreateOpen(false)}
        onSubmit={(draft) => void handleCreate(draft)}
      />
      {mergeSourceId ? (
        <div
          className="amw-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          data-testid="character-merge-dialog"
        >
          <div className="amw-dialog">
            <h3>合并造型</h3>
            <p>
              将「{characters.find((c) => c.id === mergeSourceId)?.name}」的图片转入所选目标角色的造型，并迁移分镜引用。请明确选择目标角色（不会自动选择）。
            </p>
            <div
              className="character-merge-targets"
              data-testid="character-merge-targets"
            >
              {mergeCandidates.map((candidate) => (
                <label key={candidate.id} className="character-merge-target">
                  <input
                    type="radio"
                    name="character-merge-target"
                    value={candidate.id}
                    checked={mergeTargetId === candidate.id}
                    onChange={() => setMergeTargetId(candidate.id)}
                    data-testid={`character-merge-target-${candidate.id}`}
                  />
                  <span>{candidate.name}</span>
                  <span className="amw-muted">（{candidate.id}）</span>
                </label>
              ))}
            </div>
            <div className="amw-dialog__actions">
              <button
                type="button"
                className="amw-btn"
                onClick={() => {
                  setMergeSourceId(null);
                  setMergeTargetId(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="character-merge-confirm"
                disabled={!mergeTargetId}
                onClick={() => void handleMergeRequest()}
              >
                合并造型
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
      <AppToastHost
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </>
  );
}
