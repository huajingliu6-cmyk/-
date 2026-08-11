"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import type { SceneDraftInput } from "@/projects/assets/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: SceneDraftInput) => void;
  initialDraft?: SceneDraftInput | null;
  submitLabel?: string;
};

const EMPTY: SceneDraftInput = {
  name: "",
  description: "",
  timeOfDay: "",
  imageFileName: null,
  imageObjectUrl: null,
  imageMimeType: null,
  pendingImageFile: null,
};

export function SceneCreateDialog({
  open,
  onClose,
  onSubmit,
  initialDraft = null,
  submitLabel = "创建场景",
}: Props) {
  const formId = useId();
  const confirmBounce = useChipBounce();
  const [draft, setDraft] = useState<SceneDraftInput>(
    initialDraft ?? EMPTY,
  );

  if (!open) return null;

  const revokeImage = () => {
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
  };

  const resetAndClose = () => {
    revokeImage();
    setDraft(EMPTY);
    onClose();
  };

  return (
    <div
      className="amw-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div className="amw-dialog" role="dialog" aria-modal="true">
        <h3 id={`${formId}-title`}>
          {initialDraft ? "编辑场景" : "新建场景"}
        </h3>
        <p className="amw-dialog-desc">配置场景基础信息。</p>
        <div className="amw-fields amw-fields--stack">
          <div className="amw-field">
            <label htmlFor={`${formId}-name`}>
              场景名称<span className="req">*</span>
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
          <div className="amw-field">
            <label htmlFor={`${formId}-time`}>时间</label>
            <input
              id={`${formId}-time`}
              className="amw-input"
              value={draft.timeOfDay}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, timeOfDay: e.target.value }))
              }
            />
          </div>
          <AssetImageUpload
            id={`${formId}-image`}
            label="上传场景图片"
            value={{
              fileName: draft.imageFileName,
              objectUrl: draft.imageObjectUrl,
              mimeType: draft.imageMimeType,
              pendingFile: draft.pendingImageFile,
            }}
            onChange={(image) =>
              setDraft((prev) => ({
                ...prev,
                imageFileName: image.fileName,
                imageObjectUrl: image.objectUrl,
                imageMimeType: image.mimeType,
                pendingImageFile: image.pendingFile ?? null,
              }))
            }
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
              onSubmit({ ...draft, name: draft.name.trim() });
              setDraft(EMPTY);
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
