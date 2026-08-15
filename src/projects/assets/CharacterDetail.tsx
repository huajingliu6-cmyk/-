"use client";

import { useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetBasicInfo } from "@/projects/assets/AssetBasicInfo";
import { AssetDetailImage } from "@/projects/assets/AssetDetailImage";
import { AssetDetailLayout } from "@/projects/assets/AssetDetailLayout";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { VoiceSelector } from "@/projects/assets/VoiceSelector";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";
import type {
  AudioAsset,
  CharacterAsset,
  VoiceOption,
} from "@/projects/assets/types";
import { characterDisplayStatus } from "@/projects/assets/status";
import {
  getProjectAssetImageUrl,
  resolveAssetImageSrc,
  resolveAssetImageStorageKey,
} from "@/projects/assets/asset-image-url";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";

type Props = {
  projectId: string;
  character: CharacterAsset | null;
  canEdit: boolean;
  note: string;
  projectVoices?: VoiceOption[];
  audios?: AudioAsset[];
  imageRevision?: number;
  onChange: (next: CharacterAsset) => void;
  onSave: (snapshot?: CharacterAsset) => void;
  onPreviewStatus?: (message: string) => void;
  onImageRevision?: (assetId: string, next: number) => void;
  ensurePersisted?: () => Promise<void>;
};

function resolveCharacterUploadedMediaId(
  character: CharacterAsset,
): string | null {
  // Manually uploaded bytes are stored under asset.id. imageFileName is only
  // the display name (for example "hero.png") and must not be used as a GET key.
  return character.imageFileName
    ? resolveAssetImageStorageKey({
        id: character.id,
        imageFileName: character.imageFileName,
      })
    : null;
}

function resolveCharacterPrimaryMediaId(
  character: CharacterAsset,
): string | null {
  return (
    character.primaryMediaId?.trim() ||
    resolveCharacterUploadedMediaId(character)
  );
}

function listCharacterMediaIds(character: CharacterAsset): string[] {
  const uploadedMediaId = resolveCharacterUploadedMediaId(character);
  return mergeMediaIdLists(
    character.approvedMediaIds,
    character.primaryMediaId ? [character.primaryMediaId] : [],
    uploadedMediaId ? [uploadedMediaId] : [],
  );
}

function resolveVoiceForMedia(
  character: CharacterAsset,
  mediaId: string,
): { voiceId: string | null; voiceName: string | null } {
  const fromMap = character.mediaVoices?.[mediaId];
  if (fromMap) {
    return {
      voiceId: fromMap.voiceId ?? null,
      voiceName: fromMap.voiceName ?? null,
    };
  }
  const primaryKey = resolveCharacterPrimaryMediaId(character) ?? "";
  if (primaryKey && primaryKey === mediaId) {
    return {
      voiceId: character.voiceId,
      voiceName: character.voiceName,
    };
  }
  return { voiceId: null, voiceName: null };
}

export function CharacterDetail({
  projectId,
  character,
  canEdit,
  note,
  projectVoices = [],
  audios = [],
  imageRevision = 0,
  onChange,
  onSave,
  onPreviewStatus,
  onImageRevision,
  ensurePersisted,
}: Props) {
  const saveBounce = useChipBounce();
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);

  const mediaIds = useMemo(
    () => (character ? listCharacterMediaIds(character) : []),
    [character],
  );

  const preferredMediaId = character
    ? resolveCharacterPrimaryMediaId(character) || mediaIds[0] || null
    : null;
  const mediaSyncKey = character
    ? `${character.id}:${mediaIds.join("|")}:${preferredMediaId ?? ""}`
    : "";
  const [syncedMediaKey, setSyncedMediaKey] = useState(mediaSyncKey);
  if (syncedMediaKey !== mediaSyncKey) {
    setSyncedMediaKey(mediaSyncKey);
    if (!character) {
      setSelectedMediaId(null);
    } else {
      setSelectedMediaId((prev) =>
        prev && mediaIds.includes(prev) ? prev : preferredMediaId,
      );
    }
  }

  if (!character) {
    return (
      <AssetDetailLayout
        title="角色详情"
        aria-label="角色详情"
        empty
        emptyMessage="在左侧选择角色，或新建角色开始编辑。"
      />
    );
  }

  const activeMediaId =
    selectedMediaId && mediaIds.includes(selectedMediaId)
      ? selectedMediaId
      : preferredMediaId ?? resolveAssetImageStorageKey(character) ?? null;
  const activeVoice = activeMediaId
    ? resolveVoiceForMedia(character, activeMediaId)
    : { voiceId: character.voiceId, voiceName: character.voiceName };

  const patch = (partial: Partial<CharacterAsset>) => {
    onChange({ ...character, ...partial });
  };

  const bindVoiceForActiveMedia = (voice: VoiceOption | null) => {
    const voiceId = voice?.id ?? null;
    const voiceName = voice?.name ?? null;
    const voiceStyle = voice?.style ?? null;
    if (!activeMediaId) {
      patch({ voiceId, voiceName, voiceStyle });
      return;
    }
    const mediaVoices = {
      ...(character.mediaVoices ?? {}),
      [activeMediaId]: { voiceId, voiceName },
    };
    const isPrimary =
      activeMediaId ===
      (resolveCharacterPrimaryMediaId(character) || activeMediaId);
    patch({
      mediaVoices,
      ...(isPrimary ? { voiceId, voiceName, voiceStyle } : {}),
    });
  };

  const setPrimaryMedia = (mediaId: string) => {
    const voice = resolveVoiceForMedia(character, mediaId);
    patch({
      primaryMediaId: mediaId,
      imageFileName: mediaId,
      voiceId: voice.voiceId,
      voiceName: voice.voiceName,
      voiceStyle: null,
      videoRefSafety: null,
    });
    setSelectedMediaId(mediaId);
  };

  const previewSrc = activeMediaId
    ? getProjectAssetImageUrl(projectId, activeMediaId, {
        revision: `${activeMediaId}:${imageRevision}`,
      })
    : resolveAssetImageSrc(projectId, character, {
        revision: imageRevision,
      });

  const statusLabel = characterDisplayStatus(character);
  const voiceBound = Boolean(activeVoice.voiceId);

  const voicePanel = (
    <div className="character-preview__voice">
      <div className="asset-controls__voice-head">
        <span className="asset-controls__voice-title">
          {mediaIds.length > 1 ? "本图音色" : "音色"}
        </span>
        <span className={`amw-badge${voiceBound ? " is-ok" : " is-warn"}`}>
          {voiceBound ? activeVoice.voiceName || "已绑定" : "待绑定音色"}
        </span>
      </div>
      <VoiceSelector
        label="音色选择"
        labelHidden
        value={activeVoice.voiceId}
        disabled={!canEdit}
        projectVoices={projectVoices}
        onChange={bindVoiceForActiveMedia}
      />
      {character.voiceStyle &&
      activeMediaId ===
        resolveCharacterPrimaryMediaId(character) ? (
        <p className="amw-hint">当前风格：{character.voiceStyle}</p>
      ) : null}
      <div className="asset-controls__voice-actions">
        <VoicePreviewButton
          projectId={projectId}
          voiceId={activeVoice.voiceId}
          audios={audios}
          disabled={!activeVoice.voiceId}
          onStatus={onPreviewStatus}
        />
        <button
          type="button"
          className="amw-btn amw-btn-primary"
          disabled={!canEdit || !activeVoice.voiceId}
          title="将当前选择的音色写入角色并保存"
          onClick={() => {
            saveBounce.trigger();
            const voiceId = activeVoice.voiceId;
            const voiceName = activeVoice.voiceName;
            let snapshot = character;
            if (voiceId) {
              const mediaVoices = activeMediaId
                ? {
                    ...(character.mediaVoices ?? {}),
                    [activeMediaId]: { voiceId, voiceName },
                  }
                : character.mediaVoices;
              snapshot = {
                ...character,
                ...(mediaVoices ? { mediaVoices } : {}),
                voiceId,
                voiceName,
                voiceStyle: null,
              };
              onChange(snapshot);
            }
            onSave(snapshot);
          }}
        >
          {voiceBound ? "确认绑定" : "绑定音色"}
        </button>
      </div>
    </div>
  );

  return (
    <AssetDetailLayout
      title="角色详情"
      aria-label="角色详情"
      className="character-detail"
      status={<span className="amw-badge">{statusLabel}</span>}
      banner={
        !canEdit ? (
          <div className="amw-readonly-banner">
            当前账号无资产编辑权限（默认仅项目主理人可编辑）。
          </div>
        ) : null
      }
      preview={
        <AssetDetailImage
          fill
          src={previewSrc}
          alt={character.imageFileName ?? character.name}
          testId="character-hero-image"
          emptyIcon={<UserRound size={36} strokeWidth={1.5} />}
        />
      }
      previewOverlayActions={
        <AssetImageUpload
          id={`character-image-${character.id}`}
          label="角色图片"
          compact
          replaceOnly
          hidePreview
          adaptiveContrast
          disabled={!canEdit}
          projectId={projectId}
          assetId={character.id}
          ensurePersisted={ensurePersisted}
          revision={imageRevision}
          onRevisionChange={(next) => onImageRevision?.(character.id, next)}
          value={{
            fileName: character.imageFileName,
            objectUrl: character.imageObjectUrl,
            mimeType: character.imageMimeType,
          }}
          onChange={(image) =>
            patch({
              imageFileName: image.fileName,
              imageObjectUrl: image.objectUrl,
              imageMimeType: image.mimeType,
              videoRefSafety: null,
            })
          }
        />
      }
      previewContent={
        mediaIds.length > 1 ? (
          <div
            className="ead-history-strip ead-history-strip--images ead-history-strip--compact"
            data-testid="character-media-history"
          >
            {mediaIds.map((id) => {
              const active = id === activeMediaId;

              return (
                <button
                  key={id}
                  type="button"
                  className={
                    active
                      ? "ead-history-thumb is-active"
                      : "ead-history-thumb"
                  }
                  title={id}
                  onClick={() => setSelectedMediaId(id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getProjectAssetImageUrl(projectId, id, {
                      revision: id,
                    })}
                    alt=""
                  />
                </button>
              );
            })}

            {activeMediaId &&
            activeMediaId !==
              resolveCharacterPrimaryMediaId(character) ? (
              <button
                type="button"
                className="amw-btn"
                disabled={!canEdit}
                onClick={() => setPrimaryMedia(activeMediaId)}
              >
                设为主图
              </button>
            ) : null}
          </div>
        ) : null
      }
      basicInfo={
        <AssetBasicInfo
          compact
          fields={[
            {
              key: "name",
              label: (
                <>
                  名称<span className="req">*</span>
                </>
              ),
              value: character.name,
              disabled: !canEdit,
              onChange: (v) => patch({ name: v }),
            },
            {
              key: "role",
              label: "定位",
              value: character.role,
              disabled: !canEdit,
              placeholder: "如：女主角",
              onChange: (v) => patch({ role: v }),
            },
            {
              key: "age",
              label: "年龄",
              value: character.age,
              disabled: !canEdit,
              onChange: (v) => patch({ age: v }),
            },
          ]}
        />
      }
      notes={
        <div className="amw-field amw-field--notes-compact">
          <label>备注</label>
          <textarea
            className="amw-textarea asset-controls__notes-textarea"
            value={character.description}
            disabled={!canEdit}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </div>
      }
      voice={voicePanel}
      footer={note ? <p className="amw-note">{note}</p> : null}
    />
  );
}
