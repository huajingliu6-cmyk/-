"use client";

import { useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AmwImagePreview } from "@/projects/assets/AmwImagePreview";
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
  onSave: () => void;
  onPreviewStatus?: (message: string) => void;
  onImageRevision?: (assetId: string, next: number) => void;
  ensurePersisted?: () => Promise<void>;
};

function listCharacterMediaIds(character: CharacterAsset): string[] {
  return mergeMediaIdLists(
    character.approvedMediaIds,
    character.primaryMediaId ? [character.primaryMediaId] : [],
    character.imageFileName ? [character.imageFileName] : [],
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
  const primaryKey =
    character.primaryMediaId?.trim() ||
    character.imageFileName?.trim() ||
    "";
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
  const [heroFailed, setHeroFailed] = useState(false);
  const [heroFailKey, setHeroFailKey] = useState("");

  const mediaIds = useMemo(
    () => (character ? listCharacterMediaIds(character) : []),
    [character],
  );

  const preferredMediaId = character
    ? character.primaryMediaId?.trim() ||
      character.imageFileName?.trim() ||
      mediaIds[0] ||
      null
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

  const heroKey = `${character?.id ?? ""}:${selectedMediaId ?? ""}:${imageRevision}`;
  if (heroFailKey !== heroKey) {
    setHeroFailKey(heroKey);
    setHeroFailed(false);
  }

  if (!character) {
    return (
      <section className="amw-panel" aria-label="角色详情">
        <div className="amw-panel__head">
          <h2>角色详情</h2>
        </div>
        <div className="amw-empty">在左侧选择角色，或新建角色开始编辑。</div>
      </section>
    );
  }

  const activeMediaId =
    selectedMediaId && mediaIds.includes(selectedMediaId)
      ? selectedMediaId
      : mediaIds[0] ?? resolveAssetImageStorageKey(character) ?? null;
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
      (character.primaryMediaId?.trim() ||
        character.imageFileName?.trim() ||
        activeMediaId);
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

  return (
    <section className="amw-panel" aria-label="角色详情">
      <div className="amw-panel__head">
        <h2>角色详情</h2>
        <span className="amw-badge">{characterDisplayStatus(character)}</span>
      </div>
      {!canEdit ? (
        <div className="amw-readonly-banner">
          当前账号无资产编辑权限（默认仅项目主理人可编辑）。
        </div>
      ) : null}
      <div className="amw-panel__body">
        <div className="amw-detail amw-detail--character">
          <div className="amw-character-hero" data-testid="character-hero-image">
            {previewSrc && !heroFailed ? (
              <AmwImagePreview
                className="amw-image-preview--character-hero"
                src={previewSrc}
                alt={character.imageFileName ?? character.name}
                onLoadError={() => setHeroFailed(true)}
              />
            ) : (
              <div className="amw-character-hero__empty" aria-hidden>
                <UserRound size={36} strokeWidth={1.5} />
                <span>暂无图片</span>
              </div>
            )}
          </div>

          {mediaIds.length > 1 ? (
            <div
              className="ead-history-strip ead-history-strip--images"
              data-testid="character-media-history"
            >
              {mediaIds.map((id) => {
                const active = id === activeMediaId;
                const bound = Boolean(
                  resolveVoiceForMedia(character, id).voiceId,
                );
                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      active
                        ? "ead-history-thumb is-active"
                        : "ead-history-thumb"
                    }
                    title={
                      bound
                        ? `${id}（已绑音色）`
                        : `${id}（未绑音色，请重新绑定）`
                    }
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
            </div>
          ) : null}

          <div className="amw-section">
            <h3>基础信息</h3>
            <div className="amw-fields">
              <div className="amw-field">
                <label>
                  角色名称<span className="req">*</span>
                </label>
                <input
                  className="amw-input"
                  value={character.name}
                  disabled={!canEdit}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div className="amw-field">
                <label>角色定位</label>
                <input
                  className="amw-input"
                  value={character.role}
                  disabled={!canEdit}
                  placeholder="如：女主角"
                  onChange={(e) => patch({ role: e.target.value })}
                />
              </div>
            </div>
            <div className="amw-fields">
              <div className="amw-field">
                <label>性别</label>
                <input
                  className="amw-input"
                  value={character.gender}
                  disabled={!canEdit}
                  onChange={(e) => patch({ gender: e.target.value })}
                />
              </div>
              <div className="amw-field">
                <label>年龄</label>
                <input
                  className="amw-input"
                  value={character.age}
                  disabled={!canEdit}
                  onChange={(e) => patch({ age: e.target.value })}
                />
              </div>
            </div>
            <div className="amw-field">
              <label>备注</label>
              <textarea
                className="amw-textarea"
                value={character.description}
                disabled={!canEdit}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
            <AssetImageUpload
              id={`character-image-${character.id}`}
              label="角色图片"
              tip="上传后更新上方主图；推荐插画/设定图风格"
              disabled={!canEdit}
              projectId={projectId}
              assetId={character.id}
              ensurePersisted={ensurePersisted}
              revision={imageRevision}
              hidePreview
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
            {activeMediaId &&
            mediaIds.length > 1 &&
            activeMediaId !==
              (character.primaryMediaId?.trim() ||
                character.imageFileName?.trim()) ? (
              <div className="amw-actions">
                <button
                  type="button"
                  className="amw-btn"
                  disabled={!canEdit}
                  onClick={() => setPrimaryMedia(activeMediaId)}
                >
                  设为当前主图
                </button>
              </div>
            ) : null}
          </div>

          <div className="amw-section">
            <h3>声音设定</h3>
            <VoiceSelector
              label={mediaIds.length > 1 ? "本图音色" : undefined}
              value={activeVoice.voiceId}
              disabled={!canEdit}
              projectVoices={projectVoices}
              onChange={bindVoiceForActiveMedia}
            />
            {character.voiceStyle &&
            activeMediaId ===
              (character.primaryMediaId?.trim() ||
                character.imageFileName?.trim()) ? (
              <p className="amw-hint">当前风格：{character.voiceStyle}</p>
            ) : null}
            <div className="amw-actions">
              <VoicePreviewButton
                projectId={projectId}
                voiceId={activeVoice.voiceId}
                audios={audios}
                disabled={!activeVoice.voiceId}
                onStatus={onPreviewStatus}
              />
              <button
                type="button"
                className={`amw-btn amw-btn-primary ${saveBounce.bounceClass}`}
                disabled={!canEdit || !character.name.trim()}
                onClick={() => {
                  saveBounce.trigger();
                  onSave();
                }}
                onAnimationEnd={saveBounce.onAnimationEnd}
              >
                保存
              </button>
            </div>
            {note ? <p className="amw-note">{note}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
