"use client";

import { useCallback, useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  DESIGN_IMAGE_ASPECT_RATIOS,
  DESIGN_IMAGE_ASPECT_RATIO_LABELS,
  DESIGN_IMAGE_COUNTS,
  DESIGN_IMAGE_QUALITIES,
  DESIGN_IMAGE_QUALITY_LABELS,
  type DesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";
import {
  DEFAULT_DESIGN_IMAGE_MODEL_ID,
  DESIGN_IMAGE_MODELS,
  isDesignImageModelId,
  type DesignImageModelId,
} from "@/projects/assets/episode-design/image-generation-models";
import { validateProjectAssetImageFileClient } from "@/projects/assets/upload-asset-image";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

export const ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT = 6;

export type AssetImageEditReferenceSlot =
  | {
      source: "asset-media";
      mediaId: string;
      previewUrl: string;
    }
  | {
      source: "upload";
      file: File;
      previewUrl: string;
    }
  | null;

const QUALITY_OPTIONS: GlassSelectOption[] = DESIGN_IMAGE_QUALITIES.map(
  (value) => ({
    id: value,
    label: DESIGN_IMAGE_QUALITY_LABELS[value],
  }),
);

const RATIO_OPTIONS: GlassSelectOption[] = DESIGN_IMAGE_ASPECT_RATIOS.map(
  (value) => ({
    id: value,
    label: DESIGN_IMAGE_ASPECT_RATIO_LABELS[value],
  }),
);

const COUNT_OPTIONS: GlassSelectOption[] = DESIGN_IMAGE_COUNTS.map((value) => ({
  id: String(value),
  label: `${value}张`,
}));

const MODEL_OPTIONS: GlassSelectOption[] = DESIGN_IMAGE_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
}));

export function emptyAssetImageEditSlots(): AssetImageEditReferenceSlot[] {
  return Array.from(
    { length: ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT },
    () => null,
  );
}

export function revokeAssetImageEditSlot(
  slot: AssetImageEditReferenceSlot,
): void {
  if (slot?.source === "upload" && slot.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(slot.previewUrl);
  }
}

export function revokeAssetImageEditSlots(
  slots: AssetImageEditReferenceSlot[],
): void {
  for (const slot of slots) revokeAssetImageEditSlot(slot);
}

export type AssetImageEditPanelProps = {
  previewUrl: string | null;
  previewLoading?: boolean;
  historyIds: string[];
  currentMediaId: string | null;
  historyThumbUrl: (mediaId: string) => string;
  showHistory: boolean;
  onToggleHistory: () => void;
  onSelectHistory: (mediaId: string) => void;
  referenceSlots: AssetImageEditReferenceSlot[];
  onReferenceSlotsChange: (slots: AssetImageEditReferenceSlot[]) => void;
  imageEditPrompt: string;
  onImageEditPromptChange: (value: string) => void;
  imageOptions: DesignImageGenerationOptions;
  onImageOptionsChange: (value: DesignImageGenerationOptions) => void;
  imageModelId: DesignImageModelId;
  onImageModelIdChange: (value: DesignImageModelId) => void;
  generateBusy: boolean;
  saveBusy?: boolean;
  saved?: boolean;
  canGenerate: boolean;
  canSave: boolean;
  error?: string;
  notice?: string;
  sceneActions?: React.ReactNode;
  onGenerate: () => void;
  onSave?: () => void;
  onClose: () => void;
  title?: string;
};

/**
 * Shared image-to-image edit surface (no design-prompt / text-to-image chrome).
 * Reference slots keep empty holes — they are not auto-compacted.
 */
export function AssetImageEditPanel({
  previewUrl,
  previewLoading,
  historyIds,
  currentMediaId,
  historyThumbUrl,
  showHistory,
  onToggleHistory,
  onSelectHistory,
  referenceSlots,
  onReferenceSlotsChange,
  imageEditPrompt,
  onImageEditPromptChange,
  imageOptions,
  onImageOptionsChange,
  imageModelId,
  onImageModelIdChange,
  generateBusy,
  saveBusy,
  saved,
  canGenerate,
  canSave,
  error,
  notice,
  sceneActions,
  onGenerate,
  onSave,
  onClose,
  title = "图片二次编辑",
}: AssetImageEditPanelProps) {
  const fileInputRefs = useRef<Array<HTMLInputElement | null>>(
    Array.from({ length: ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT }, () => null),
  );

  const handleSlotUpload = useCallback(
    (index: number, fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      const validationError = validateProjectAssetImageFileClient(file);
      if (validationError) return;
      const previewUrlNext = URL.createObjectURL(file);
      const next = [...referenceSlots];
      revokeAssetImageEditSlot(next[index] ?? null);
      next[index] = { source: "upload", file, previewUrl: previewUrlNext };
      onReferenceSlotsChange(next);
      const input = fileInputRefs.current[index];
      if (input) input.value = "";
    },
    [onReferenceSlotsChange, referenceSlots],
  );

  const removeSlot = useCallback(
    (index: number) => {
      const next = [...referenceSlots];
      revokeAssetImageEditSlot(next[index] ?? null);
      next[index] = null;
      onReferenceSlotsChange(next);
    },
    [onReferenceSlotsChange, referenceSlots],
  );

  return (
    <div
      className="ead-modal-backdrop"
      role="presentation"
      data-testid="asset-image-edit-panel"
      onClick={onClose}
    >
      <div
        className="ead-modal ead-modal--wide aie-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ead-modal__head">
          <h2>{title}</h2>
          <button type="button" className="amw-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="aie-panel__body">
          <div className="aie-panel__preview-col">
            <div className="ead-modal__section-head">
              <span>图片预览</span>
              <button
                type="button"
                className="amw-btn ead-modal__icon-btn"
                data-testid="aie-history-toggle"
                onClick={onToggleHistory}
              >
                历史 {historyIds.length > 0 ? historyIds.length : ""}
              </button>
            </div>
            <div
              className="ead-preview-frame"
              data-testid="aie-image-preview"
            >
              {previewLoading ? (
                <p className="ead-muted">正在加载预览…</p>
              ) : previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="当前预览" />
              ) : (
                <p className="ead-muted">暂无预览</p>
              )}
            </div>
            {showHistory ? (
              <div
                className="ead-history-strip ead-history-strip--images"
                data-testid="aie-image-history"
              >
                {historyIds.length === 0 ? (
                  <p className="ead-muted">暂无图片历史</p>
                ) : (
                  [...historyIds].reverse().map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={
                        id === currentMediaId
                          ? "ead-history-thumb is-active"
                          : "ead-history-thumb"
                      }
                      onClick={() => onSelectHistory(id)}
                      title={id}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={historyThumbUrl(id)} alt="" />
                    </button>
                  ))
                )}
              </div>
            ) : null}

            <div
              className="ead-generation-options"
              data-testid="aie-generation-options"
            >
              <div className="ead-generation-option">
                <GlassSelect
                  label="画质"
                  value={imageOptions.quality}
                  disabled={generateBusy}
                  options={QUALITY_OPTIONS}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(value) =>
                    onImageOptionsChange({
                      ...imageOptions,
                      quality: value as DesignImageGenerationOptions["quality"],
                    })
                  }
                />
              </div>
              <div className="ead-generation-option">
                <GlassSelect
                  label="比例"
                  value={imageOptions.aspectRatio}
                  disabled={generateBusy}
                  options={RATIO_OPTIONS}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(value) =>
                    onImageOptionsChange({
                      ...imageOptions,
                      aspectRatio:
                        value as DesignImageGenerationOptions["aspectRatio"],
                    })
                  }
                />
              </div>
              <div className="ead-generation-option">
                <GlassSelect
                  label="张数"
                  value={String(imageOptions.count)}
                  disabled={generateBusy}
                  options={COUNT_OPTIONS}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(value) => {
                    const count = Number(value);
                    if (
                      !DESIGN_IMAGE_COUNTS.includes(
                        count as DesignImageGenerationOptions["count"],
                      )
                    ) {
                      return;
                    }
                    onImageOptionsChange({
                      ...imageOptions,
                      count: count as DesignImageGenerationOptions["count"],
                    });
                  }}
                />
              </div>
              <div className="ead-generation-option">
                <GlassSelect
                  label="模型"
                  value={imageModelId}
                  disabled={generateBusy}
                  options={MODEL_OPTIONS}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(value) => {
                    if (isDesignImageModelId(value)) {
                      onImageModelIdChange(value);
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div className="aie-panel__edit-col">
            <div className="ead-image-edit-panel__head">二次编辑</div>
            <div
              className="ead-reference-slots"
              data-testid="aie-reference-slots"
            >
              {referenceSlots.map((slot, index) => (
                <div
                  key={`aie-slot-${index}`}
                  className={`ead-reference-slot${slot ? " is-filled" : ""}`}
                  data-testid={`aie-reference-slot-${index + 1}`}
                >
                  <button
                    type="button"
                    className="ead-reference-slot__hit"
                    disabled={generateBusy}
                    title={
                      slot
                        ? `替换第${index + 1}张参考图`
                        : `上传第${index + 1}张参考图`
                    }
                    onClick={() => fileInputRefs.current[index]?.click()}
                  >
                    <span className="ead-reference-slot__index" aria-hidden>
                      {index + 1}
                    </span>
                    {slot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slot.previewUrl} alt={`参考图 ${index + 1}`} />
                    ) : (
                      <ImagePlus
                        className="ead-reference-slot__empty-icon"
                        aria-hidden
                      />
                    )}
                  </button>
                  {slot ? (
                    <button
                      type="button"
                      className="ead-reference-slot__remove"
                      data-testid={`aie-reference-slot-remove-${index + 1}`}
                      title={`删除第${index + 1}张参考图`}
                      disabled={generateBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlot(index);
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <input
                    ref={(el) => {
                      fileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    className="ead-reference-slot__file"
                    onChange={(e) =>
                      handleSlotUpload(index, e.target.files)
                    }
                  />
                </div>
              ))}
            </div>

            <label className="amw-field">
              <span>二次编辑要求</span>
              <textarea
                className="amw-textarea"
                data-testid="aie-edit-prompt"
                rows={8}
                disabled={generateBusy}
                placeholder="请描述图片修改要求，例如：保留第1张图片的人脸，使用第2张图片的服装，参考第3张图片的灯光，第4张图片作为背景。"
                value={imageEditPrompt}
                onChange={(e) => onImageEditPromptChange(e.target.value)}
              />
            </label>

            {sceneActions}

            {notice ? (
              <p className="ead-muted" role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="ead-error" role="alert" data-testid="aie-error">
                {error}
              </p>
            ) : null}

            <div className="ead-image-edit-panel__foot aie-panel__foot">
              {onSave ? (
                <button
                  type="button"
                  className="amw-btn"
                  data-testid="aie-save"
                  disabled={!canSave || saveBusy || generateBusy || saved}
                  onClick={() => onSave()}
                >
                  {saved ? "已保存" : saveBusy ? "保存中…" : "保存图片"}
                </button>
              ) : null}
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="aie-generate"
                disabled={!canGenerate || generateBusy}
                onClick={onGenerate}
              >
                {generateBusy ? "生成中…" : "生图"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  DEFAULT_DESIGN_IMAGE_MODEL_ID,
};
