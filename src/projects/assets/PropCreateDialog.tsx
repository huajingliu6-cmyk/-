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
  const [formError, setFormError] = useState("");
  const isNew = !initialDraft;

  if (!open) return null;

  const revokeImage = () => {
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
  };

  const resetAndClose = () => {
    revokeImage();
    setDraft(EMPTY);
    setFormError("");
    onClose();
  };

  const hasImage = Boolean(
    draft.pendingImageFile ||
      (!isNew && (draft.imageFileName || draft.imageObjectUrl)),
  );

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
          <AssetImageUpload
            id={`${formId}-image`}
            label={
              isNew ? (
                <>
                  上传道具图片<span className="req">*</span>
                </>
              ) : (
                "上传道具图片"
              )
            }
            value={{
              fileName: draft.imageFileName,
              objectUrl: draft.imageObjectUrl,
              mimeType: draft.imageMimeType,
              pendingFile: draft.pendingImageFile,
            }}
            onChange={(image) => {
              setFormError("");
              setDraft((prev) => ({
                ...prev,
                imageFileName: image.fileName,
                imageObjectUrl: image.objectUrl,
                imageMimeType: image.mimeType,
                pendingImageFile: image.pendingFile ?? null,
              }));
            }}
          />
          {formError ? (
            <p className="amw-field-error" role="alert">
              {formError}
            </p>
          ) : null}
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
              if (isNew && !draft.pendingImageFile) {
                setFormError("请先上传道具图片后再创建");
                return;
              }
              if (!hasImage) {
                setFormError("请先上传道具图片后再保存");
                return;
              }
              confirmBounce.trigger();
              onSubmit({ ...draft, name: draft.name.trim() });
              setDraft(EMPTY);
              setFormError("");
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
