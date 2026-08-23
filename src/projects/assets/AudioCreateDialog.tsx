"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { GlassSelect } from "@/shell/glass-select";
import { AssetAudioUpload } from "@/projects/assets/AssetAudioUpload";
import type {
  AudioAssetKind,
  AudioDraftInput,
} from "@/projects/assets/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: AudioDraftInput) => void;
  initialDraft?: AudioDraftInput | null;
  submitLabel?: string;
  /** Lock type select to a fixed kind (e.g. voice upload from VoiceSelector). */
  fixedType?: AudioAssetKind;
  title?: string;
  description?: string;
};

const CREATE_TYPE_OPTIONS = [
  { id: "voice", label: "音色（角色可绑定）" },
  { id: "music", label: "音乐" },
  { id: "sfx", label: "音效" },
  { id: "narration", label: "旁白" },
] as const;

const EMPTY: AudioDraftInput = {
  name: "",
  type: "voice",
  duration: "",
  source: "",
  fileName: null,
  objectUrl: null,
  mimeType: null,
  pendingAudioFile: null,
};

export function AudioCreateDialog({
  open,
  onClose,
  onSubmit,
  initialDraft = null,
  submitLabel = "创建音频",
  fixedType,
  title,
  description,
}: Props) {
  const formId = useId();
  const confirmBounce = useChipBounce();
  const emptyDraft: AudioDraftInput = {
    ...EMPTY,
    ...(fixedType ? { type: fixedType } : {}),
  };
  const [draft, setDraft] = useState<AudioDraftInput>(
    initialDraft
      ? {
          ...initialDraft,
          ...(fixedType ? { type: fixedType } : {}),
        }
      : emptyDraft,
  );

  if (!open) return null;

  const resetAndClose = () => {
    if (draft.objectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.objectUrl);
    }
    setDraft(emptyDraft);
    onClose();
  };

  const requireFile =
    fixedType === "voice" || draft.type === "voice";

  return (
    <div
      className="amw-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div className="amw-dialog" role="dialog" aria-modal="true">
        <h3>
          {title ??
            (initialDraft ? "编辑音频" : fixedType === "voice" ? "上传音色" : "新建音频")}
        </h3>
        <p className="amw-dialog-desc">
          {description ??
            (fixedType === "voice"
              ? "上传 MP3 / WAV / OGG 音色文件，保存后可在角色详情中选择并绑定。"
              : "可登记音乐、音效、旁白，或上传自定义音色供角色绑定。选择文件后先保存资产再上传到项目目录。")}
        </p>
        <div className="amw-fields amw-fields--stack">
          {fixedType ? (
            <div className="amw-field">
              <label htmlFor={`${formId}-type-fixed`}>类型</label>
              <input
                id={`${formId}-type-fixed`}
                className="amw-input"
                value={
                  CREATE_TYPE_OPTIONS.find((o) => o.id === fixedType)?.label ??
                  fixedType
                }
                disabled
                readOnly
              />
            </div>
          ) : (
            <GlassSelect
              id={`${formId}-type`}
              label="类型"
              value={draft.type}
              options={[...CREATE_TYPE_OPTIONS]}
              onChange={(id) =>
                setDraft((prev) => ({
                  ...prev,
                  type: id as AudioAssetKind,
                }))
              }
            />
          )}

          <AssetAudioUpload
            id={`${formId}-file`}
            label={
              fixedType === "voice" ? "上传音色文件" : "上传音色 / 音频文件"
            }
            tip={
              fixedType === "voice"
                ? "支持 MP3 / WAV / OGG，最大 50MB。名称与音频文件均必填。"
                : "支持 MP3 / WAV / OGG，最大 50MB。选择「音色」后上传，即可在角色详情中选用。"
            }
            value={{
              fileName: draft.fileName,
              objectUrl: draft.objectUrl,
              mimeType: draft.mimeType,
              pendingFile: draft.pendingAudioFile,
            }}
            onChange={(audio) => {
              setDraft((prev) => ({
                ...prev,
                name:
                  prev.name.trim() ||
                  (audio.fileName
                    ? audio.fileName.replace(/\.[^.]+$/, "")
                    : prev.name),
                type: fixedType
                  ? fixedType
                  : prev.type === "music" || prev.type === "sfx"
                    ? prev.type
                    : "voice",
                source: audio.fileName
                  ? `本地上传：${audio.fileName}`
                  : prev.source,
                fileName: audio.fileName,
                objectUrl: audio.objectUrl,
                mimeType: audio.mimeType,
                pendingAudioFile: audio.pendingFile ?? null,
              }));
            }}
            onDurationRead={(label) => {
              setDraft((prev) => ({
                ...prev,
                duration: label || prev.duration,
              }));
            }}
          />

          <div className="amw-field">
            <label htmlFor={`${formId}-name`}>
              名称<span className="req">*</span>
            </label>
            <input
              id={`${formId}-name`}
              className="amw-input"
              value={draft.name}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </div>
          {fixedType === "voice" ? null : (
            <>
              <div className="amw-field">
                <label htmlFor={`${formId}-duration`}>时长</label>
                <input
                  id={`${formId}-duration`}
                  className="amw-input"
                  value={draft.duration}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, duration: e.target.value }))
                  }
                />
              </div>
              <div className="amw-field">
                <label htmlFor={`${formId}-source`}>来源</label>
                <input
                  id={`${formId}-source`}
                  className="amw-input"
                  value={draft.source}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, source: e.target.value }))
                  }
                />
              </div>
            </>
          )}
        </div>
        <div className="amw-dialog-actions">
          <button type="button" className="amw-btn" onClick={resetAndClose}>
            取消
          </button>
          <button
            type="button"
            className={`amw-btn amw-btn-primary ${confirmBounce.bounceClass}`}
            disabled={
              !draft.name.trim() ||
              (requireFile &&
                !draft.pendingAudioFile &&
                !draft.fileName)
            }
            onClick={() => {
              confirmBounce.trigger();
              onSubmit({
                ...draft,
                name: draft.name.trim(),
                type: fixedType ?? draft.type,
              });
              setDraft(emptyDraft);
            }}
            onAnimationEnd={confirmBounce.onAnimationEnd}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
