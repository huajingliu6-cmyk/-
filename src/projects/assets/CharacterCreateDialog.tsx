"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { VoiceSelector } from "@/projects/assets/VoiceSelector";
import type { CharacterDraftInput, VoiceOption } from "@/projects/assets/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: CharacterDraftInput) => void;
  projectVoices?: VoiceOption[];
  initialDraft?: CharacterDraftInput | null;
  submitLabel?: string;
};

const EMPTY: CharacterDraftInput = {
  name: "",
  role: "",
  description: "",
  clothing: "",
  age: "",
  voiceId: null,
  imageFileName: null,
  imageObjectUrl: null,
  imageMimeType: null,
  pendingImageFile: null,
};

export function CharacterCreateDialog({
  open,
  onClose,
  onSubmit,
  projectVoices = [],
  initialDraft = null,
  submitLabel,
}: Props) {
  if (!open) return null;
  return (
    <CharacterCreateDialogInner
      key={initialDraft ? `edit-${initialDraft.name}` : "new"}
      onClose={onClose}
      onSubmit={onSubmit}
      projectVoices={projectVoices}
      initialDraft={initialDraft}
      submitLabel={submitLabel}
    />
  );
}

function CharacterCreateDialogInner({
  onClose,
  onSubmit,
  projectVoices,
  initialDraft,
  submitLabel,
}: {
  onClose: () => void;
  onSubmit: (draft: CharacterDraftInput) => void;
  projectVoices: VoiceOption[];
  initialDraft: CharacterDraftInput | null;
  submitLabel?: string;
}) {
  const formId = useId();
  const confirmBounce = useChipBounce();
  const seed = initialDraft ?? EMPTY;
  const [draft, setDraft] = useState<CharacterDraftInput>(seed);
  const [voice, setVoice] = useState<VoiceOption | null>(() =>
    seed.voiceId
      ? projectVoices.find((v) => v.id === seed.voiceId) ?? null
      : null,
  );

  const patch = (partial: Partial<CharacterDraftInput>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const revokeImage = () => {
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
  };

  const resetAndClose = () => {
    revokeImage();
    setDraft(EMPTY);
    setVoice(null);
    onClose();
  };

  const title = initialDraft ? "编辑角色" : "新建角色";
  const actionLabel = submitLabel ?? (initialDraft ? "保存角色" : "创建角色");

  return (
    <div
      className="amw-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div
        className="amw-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <h3 id={`${formId}-title`}>{title}</h3>
        <p className="amw-dialog-desc">
          填写角色基础设定。本阶段仅本地状态，不调用 AI 生成。
        </p>

        <div className="amw-fields amw-fields--stack">
          <div className="amw-field">
            <label htmlFor={`${formId}-name`}>
              角色名称<span className="req">*</span>
            </label>
            <input
              id={`${formId}-name`}
              className="amw-input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="amw-field">
            <label htmlFor={`${formId}-role`}>角色定位</label>
            <input
              id={`${formId}-role`}
              className="amw-input"
              placeholder="如：女主角"
              value={draft.role}
              onChange={(e) => patch({ role: e.target.value })}
            />
          </div>
          <div className="amw-field">
            <label htmlFor={`${formId}-desc`}>角色简介</label>
            <textarea
              id={`${formId}-desc`}
              className="amw-textarea"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
          <div className="amw-field">
            <label htmlFor={`${formId}-age`}>角色年龄</label>
            <input
              id={`${formId}-age`}
              className="amw-input"
              value={draft.age}
              onChange={(e) => patch({ age: e.target.value })}
            />
          </div>
          <AssetImageUpload
            id={`${formId}-image`}
            label="上传角色图片"
            tip="上传角色图片推荐插画/设定图风格（避免写实真人，以免视频参考被拒）"
            value={{
              fileName: draft.imageFileName,
              objectUrl: draft.imageObjectUrl,
              mimeType: draft.imageMimeType,
              pendingFile: draft.pendingImageFile,
            }}
            onChange={(image) =>
              patch({
                imageFileName: image.fileName,
                imageObjectUrl: image.objectUrl,
                imageMimeType: image.mimeType,
                pendingImageFile: image.pendingFile ?? null,
              })
            }
          />
          <VoiceSelector
            label="绑定音色"
            value={voice?.id ?? draft.voiceId ?? null}
            projectVoices={projectVoices}
            onChange={(v) => {
              setVoice(v);
              patch({ voiceId: v?.id ?? null });
            }}
          />
        </div>

        <div className="amw-dialog-actions">
          <button type="button" className="amw-btn" onClick={resetAndClose}>
            取消
          </button>
          <button
            type="button"
            className={`amw-btn amw-btn-primary ${confirmBounce.bounceClass}`}
            disabled={!draft.name.trim()}
            onClick={() => {
              confirmBounce.trigger();
              onSubmit({
                ...draft,
                name: draft.name.trim(),
                voiceId: voice?.id ?? draft.voiceId ?? null,
              });
              setDraft(EMPTY);
              setVoice(null);
            }}
            onAnimationEnd={confirmBounce.onAnimationEnd}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
