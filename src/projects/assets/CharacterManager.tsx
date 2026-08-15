"use client";

import { useEffect, useRef, useState } from "react";
import { CharacterList, CharacterListHeader } from "@/projects/assets/CharacterList";
import { CharacterDetail } from "@/projects/assets/CharacterDetail";
import { CharacterCreateDialog } from "@/projects/assets/CharacterCreateDialog";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
import {
  findVoiceOption,
  voiceOptionsFromAudios,
} from "@/projects/assets/voice-catalog";
import { deriveCharacterStatus } from "@/projects/assets/status";
import { persistThenUploadAssetImage } from "@/projects/assets/upload-asset-image";
import type {
  AudioAsset,
  CharacterAsset,
  CharacterDraftInput,
} from "@/projects/assets/types";

type Props = {
  projectId: string;
  characters: CharacterAsset[];
  audios: AudioAsset[];
  canEdit: boolean;
  onChange: (next: CharacterAsset[]) => void;
  onPersist: (next: CharacterAsset[]) => Promise<void>;
};

export function CharacterManager({
  projectId,
  characters,
  audios,
  canEdit,
  onChange,
  onPersist,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    characters[0]?.id ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>(
    {},
  );
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
    const voice = findVoiceOption(draft.voiceId, projectVoices);
    const id = `char_${Date.now().toString(36)}`;
    const pendingFile = draft.pendingImageFile ?? null;
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
    const created: CharacterAsset = {
      id,
      projectId,
      name: draft.name.trim(),
      role: draft.role.trim(),
      description: draft.description.trim(),
      appearance: "",
      clothing: draft.clothing.trim(),
      age: draft.age.trim(),
      gender: "",
      voiceId: voice?.id ?? null,
      voiceName: voice?.name ?? null,
      voiceStyle: voice?.style ?? null,
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft",
    };
    created.status = deriveCharacterStatus(created);
    const next = [...charactersRef.current, created];
    charactersRef.current = next;
    onChange(next);
    setSelectedId(id);
    setCreateOpen(false);
    setNote("正在保存角色…");
    try {
      await onPersist(next);
      if (pendingFile) {
        const uploaded = await persistThenUploadAssetImage({
          projectId,
          assetId: id,
          pendingFile,
          persist: async () => {
            await onPersist(charactersRef.current);
          },
        });
        if (uploaded) {
          const uploadedNext = charactersRef.current.map((character) =>
            character.id === id
              ? {
                  ...character,
                  imageFileName: uploaded.imageFileName,
                  imageObjectUrl: null,
                  imageMimeType: uploaded.imageMimeType,
                  status: deriveCharacterStatus({
                    ...character,
                    imageFileName: uploaded.imageFileName,
                    imageObjectUrl: null,
                  }),
                }
              : character,
          );
          charactersRef.current = uploadedNext;
          onChange(uploadedNext);
          await onPersist(uploadedNext);
        }
        setImageRevisions((prev) => ({
          ...prev,
          [id]: (prev[id] ?? 0) + 1,
        }));
      }
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
            characters={characters}
            selectedId={selectedId}
            canEdit={canEdit}
            imageRevisions={imageRevisions}
            onSelect={setSelectedId}
            onCreate={() => setCreateOpen(true)}
          />
        }
        details={
          <CharacterDetail
            projectId={projectId}
            character={selected}
            canEdit={canEdit}
            note={note}
            projectVoices={projectVoices}
            audios={audios}
            imageRevision={selected ? (imageRevisions[selected.id] ?? 0) : 0}
            onChange={updateOne}
            onSave={handleSave}
            onPreviewStatus={setNote}
            onImageRevision={(assetId, next) =>
              setImageRevisions((prev) => ({ ...prev, [assetId]: next }))
            }
            ensurePersisted={async () => {
              await onPersist(charactersRef.current);
            }}
          />
        }
      />
      <CharacterCreateDialog
        open={createOpen}
        projectVoices={projectVoices}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}
