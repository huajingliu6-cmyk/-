"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import type { PropDraftInput } from "@/projects/assets/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: PropDraftInput) => void;
  initialDraft?: PropDraftInput | null;
  submitLabel?: string;
};

const EMPTY: PropDraftInput = {
  name: "",
  description: "",
  imageFileName: null,
  imageObjectUrl: null,
  imageMimeType: null,
  pendingImageFile: null,
};

export function PropCreateDialog({
  open,
  onClose,
  onSubmit,
  initialDraft = null,
  submitLabel = "创建道具",
}: Props) {
  const formId = useId();
  const confirmBounce = useChipBounce();
  const [draft, setDraft] = useState<PropDraftInput>(initialDraft ?? EMPTY);

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
        <h3>{initialDraft ? "编辑道具" : "新增道具"}</h3>
        <p className="amw-dialog-desc">填写道具信息。</p>
        <div className="amw-fields amw-fields--stack">
          <div className="amw-field">
            <label htmlFor={`${formId}-name`}>
              道具名称<span className="req">*</span>
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
            <label htmlFor={`${formId}-desc`}>描述</label>
            <textarea
              id={`${formId}-desc`}
              className="amw-textarea"
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>
          <AssetImageUpload
            id={`${formId}-image`}
            label="上传道具图片"
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
