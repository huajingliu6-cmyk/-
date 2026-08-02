"use client";

import { useEffect, useMemo, useState } from "react";
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

  const mediaIds = useMemo(
    () => (character ? listCharacterMediaIds(character) : []),
    [character],
  );

  const mediaIdsKey = mediaIds.join("|");
  useEffect(() => {
    if (!character) {
      setSelectedMediaId(null);
      return;
    }
    const ids = listCharacterMediaIds(character);
    const preferred =
      character.primaryMediaId?.trim() ||
      character.imageFileName?.trim() ||
      ids[0] ||
      null;
    setSelectedMediaId((prev) =>
      prev && ids.includes(prev) ? prev : preferred,
    );
  }, [character, mediaIdsKey]);

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
        <div className="amw-detail">
          {previewSrc ? (
            <AmwImagePreview
              className="amw-image-preview--detail"
              src={previewSrc}
              alt={character.imageFileName ?? character.name}
            />
          ) : null}
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
            <div className="amw-field">
              <label>角色简介</label>
              <textarea
                className="amw-textarea"
                value={character.description}
                disabled={!canEdit}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          </div>

          <div className="amw-section">
            <h3>视觉设定</h3>
            <AssetImageUpload
              id={`character-image-${character.id}`}
              label="角色图片"
              tip="上传角色图片推荐插画/设定图风格（避免写实真人，以免视频参考被拒）"
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
            <div className="amw-field">
              <label>外貌描述</label>
              <textarea
                className="amw-textarea"
                value={character.appearance}
                disabled={!canEdit}
                onChange={(e) => patch({ appearance: e.target.value })}
              />
            </div>
            <div className="amw-field">
              <label>服装描述</label>
              <textarea
                className="amw-textarea"
                value={character.clothing}
                disabled={!canEdit}
                onChange={(e) => patch({ clothing: e.target.value })}
              />
            </div>
            <div className="amw-fields">
              <div className="amw-field">
                <label>年龄</label>
                <input
                  className="amw-input"
                  value={character.age}
                  disabled={!canEdit}
                  onChange={(e) => patch({ age: e.target.value })}
                />
              </div>
              <div className="amw-field">
                <label>性别</label>
                <input
                  className="amw-input"
                  value={character.gender}
                  disabled={!canEdit}
                  onChange={(e) => patch({ gender: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="amw-section">
            <h3>声音设定</h3>
            <p className="amw-hint">
              {mediaIds.length > 1
                ? "同一角色的每张历史图需单独绑定音色；切换上方图片后请重新选择并保存。"
                : "优先从桌面「本地音频库」选择音色。审批入库后抽卡师不可改；主理人在此修改将同步到各集关联人物。"}
            </p>
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
