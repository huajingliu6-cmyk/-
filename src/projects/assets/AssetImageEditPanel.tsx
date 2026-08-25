"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Settings2, ShieldCheck, X } from "lucide-react";
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
import { GenerationParamsPopover } from "@/projects/assets/GenerationParamsPopover";
import {
  DesignGenerationOverlay,
  type AssetGenerationProgress,
} from "@/projects/assets/DesignGenerationOverlay";
import { validateProjectAssetImageFileClient } from "@/projects/assets/upload-asset-image";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";
import { MediaHistoryStrip } from "@/projects/ui/MediaHistoryStrip";

export const ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT = 6;

export type AssetImageEditReferenceSlot =
  | {
      source: "asset-media";
      mediaId: string;
      previewUrl: string;
      name?: string;
    }
  | {
      source: "upload";
      file: File;
      previewUrl: string;
      personalMaterialId?: string;
    }
  | {
      source: "personal-material";
      personalMaterialId: string;
      mediaId: string;
      previewUrl: string;
      name: string;
    }
  | {
      source: "system-material";
      materialId: string;
      personalMaterialId: string;
      mediaId: string;
      previewUrl: string;
      name: string;
    }
  | null;

export type AssetImageEditPanelVariant = "image-edit" | "character-look";

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
  /** When false, history toggle + strip are not rendered (new look editor). */
  showHistoryToggle?: boolean;
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
  /** When set with generateBusy, renders progress overlay on the preview stage. */
  generationProgress?: AssetGenerationProgress | null;
  saveBusy?: boolean;
  saved?: boolean;
  /** When true, precheck button shows verified state. */
  precheckCertified?: boolean;
  canGenerate: boolean;
  canSave?: boolean;
  saveLabel?: string;
  generateLabel?: string;
  precheckBusy?: boolean;
  canPrecheck?: boolean;
  onPrecheck?: () => void;
  precheckLabel?: string;
  error?: string;
  notice?: string;
  fieldErrors?: {
    prompt?: boolean;
    referenceImages?: boolean;
    model?: boolean;
  };
  sceneActions?: React.ReactNode;
  onGenerate: () => void;
  onSave?: () => void;
  onClose: () => void;
  title?: string;
  variant?: AssetImageEditPanelVariant;
  lookName?: string;
  onLookNameChange?: (value: string) => void;
  onLookNameBlur?: () => void;
  inheritHint?: string;
  showCancel?: boolean;
  promptLabel?: string;
  promptPlaceholder?: string;
  /** Empty preview copy for character-look (default mentions history). */
  emptyPreviewLabel?: string;
  /** Footer summary for character-look (left of action buttons). */
  generationSummary?: string | null;
  /**
   * character-look only: clicking a slot opens upload / library menu instead of
   * immediately opening the file picker.
   */
  enableMaterialLibraryPick?: boolean;
  onPickMaterialLibrary?: (slotIndex: number) => void;
  /** Optional: after local file chosen, ask whether to also save to personal space. */
  onUploadWithPersonalSaveOption?: (
    slotIndex: number,
    file: File,
    previewUrl: string,
  ) => void;
};

/**
 * Shared image-to-image edit surface.
 * `image-edit`: left preview + inline params; right refs + prompt.
 * `character-look`: left preview + name; right 3×2 refs + look prompt + params popover.
 */
export function AssetImageEditPanel({
  previewUrl,
  previewLoading,
  historyIds,
  currentMediaId,
  historyThumbUrl,
  showHistory,
  showHistoryToggle = true,
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
  generationProgress = null,
  saveBusy,
  saved,
  precheckCertified = false,
  canGenerate,
  canSave = false,
  saveLabel = "保存图片",
  generateLabel = "生图",
  precheckBusy = false,
  canPrecheck = false,
  onPrecheck,
  precheckLabel = "人物校验",
  error,
  notice,
  fieldErrors,
  sceneActions,
  onGenerate,
  onSave,
  onClose,
  title = "图片二次编辑",
  variant = "image-edit",
  lookName = "",
  onLookNameChange,
  onLookNameBlur,
  inheritHint,
  showCancel = false,
  promptLabel,
  promptPlaceholder,
  emptyPreviewLabel,
  generationSummary = null,
  enableMaterialLibraryPick = false,
  onPickMaterialLibrary,
  onUploadWithPersonalSaveOption,
}: AssetImageEditPanelProps) {
  const isCharacterLook = variant === "character-look";
  const historyUiEnabled = showHistoryToggle;
  const resolvedEmptyPreview =
    emptyPreviewLabel ??
    (isCharacterLook ? "暂无预览" : "暂无预览");
  const resolvedPromptLabel =
    promptLabel ?? (isCharacterLook ? "造型提示词" : "二次编辑要求");
  const resolvedPromptPlaceholder =
    promptPlaceholder ??
    (isCharacterLook
      ? "只描述服装、年龄、伤病、发型、妆容、状态等造型变化；默认继承主形象人脸、身份与基础体型。"
      : "请描述图片修改要求，例如：保留第1张图片的人脸，使用第2张图片的服装，参考第3张图片的灯光，第4张图片作为背景。");
  const [uploadError, setUploadError] = useState("");
  const [paramsOpen, setParamsOpen] = useState(false);
  const [slotMenuIndex, setSlotMenuIndex] = useState<number | null>(null);
  const [slotMenuPosition, setSlotMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const paramsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRefs = useRef<Array<HTMLInputElement | null>>(
    Array.from({ length: ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT }, () => null),
  );
  const slotHitRefs = useRef<Array<HTMLButtonElement | null>>(
    Array.from({ length: ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT }, () => null),
  );

  const closeSlotMenu = useCallback(() => {
    setSlotMenuIndex(null);
    setSlotMenuPosition(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".gs__menu--portal, .gs__menu")) return;
      if (slotMenuIndex != null) {
        closeSlotMenu();
        return;
      }
      if (paramsOpen) {
        setParamsOpen(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeSlotMenu, onClose, paramsOpen, slotMenuIndex]);

  const handleSlotUpload = useCallback(
    (index: number, fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      const validationError = validateProjectAssetImageFileClient(file);
      if (validationError) {
        setUploadError(validationError);
        const input = fileInputRefs.current[index];
        if (input) input.value = "";
        return;
      }
      setUploadError("");
      const previewUrlNext = URL.createObjectURL(file);
      if (onUploadWithPersonalSaveOption) {
        onUploadWithPersonalSaveOption(index, file, previewUrlNext);
        const input = fileInputRefs.current[index];
        if (input) input.value = "";
        return;
      }
      const next = [...referenceSlots];
      revokeAssetImageEditSlot(next[index] ?? null);
      next[index] = { source: "upload", file, previewUrl: previewUrlNext };
      onReferenceSlotsChange(next);
      const input = fileInputRefs.current[index];
      if (input) input.value = "";
    },
    [onReferenceSlotsChange, onUploadWithPersonalSaveOption, referenceSlots],
  );

  useEffect(() => {
    if (slotMenuIndex == null) return;
    const updatePosition = () => {
      const anchor = slotHitRefs.current[slotMenuIndex];
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setSlotMenuPosition({
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width / 2,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [slotMenuIndex]);

  const removeSlot = useCallback(
    (index: number) => {
      const next = [...referenceSlots];
      revokeAssetImageEditSlot(next[index] ?? null);
      next[index] = null;
      onReferenceSlotsChange(next);
      setUploadError("");
      closeSlotMenu();
    },
    [closeSlotMenu, onReferenceSlotsChange, referenceSlots],
  );

  const openSlotMenu = useCallback(
    (index: number) => {
      if (generateBusy) return;
      if (enableMaterialLibraryPick && isCharacterLook) {
        const anchor = slotHitRefs.current[index];
        if (anchor) {
          const rect = anchor.getBoundingClientRect();
          setSlotMenuPosition({
            top: rect.top + rect.height / 2,
            left: rect.left + rect.width / 2,
          });
        }
        setSlotMenuIndex(index);
        return;
      }
      fileInputRefs.current[index]?.click();
    },
    [enableMaterialLibraryPick, generateBusy, isCharacterLook],
  );

  const inlineGenerationOptions = (
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
      <div
        className={`ead-generation-option${fieldErrors?.model ? " is-field-error" : ""}`}
      >
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
  );

  const referenceSlotsBlock = (
    <div
      className={`ead-reference-slots aie-panel__refs${
        isCharacterLook ? " character-look-editor__refs" : ""
      }${fieldErrors?.referenceImages ? " is-field-error" : ""}`}
      data-testid="aie-reference-slots"
      data-invalid={fieldErrors?.referenceImages ? "true" : undefined}
    >
      {referenceSlots.map((slot, index) => (
        <div
          key={`aie-slot-${index}`}
          className={`ead-reference-slot aie-panel__ref-slot${
            slot ? " is-filled" : ""
          }`}
          data-testid={`aie-reference-slot-${index + 1}`}
        >
          <button
            type="button"
            ref={(el) => {
              slotHitRefs.current[index] = el;
            }}
            className="ead-reference-slot__hit"
            disabled={generateBusy}
            title={
              slot
                ? `替换第${index + 1}张参考图`
                : `选择第${index + 1}张参考图`
            }
            onClick={() => openSlotMenu(index)}
          >
            <span className="ead-reference-slot__index" aria-hidden>
              {index + 1}
            </span>
            {slot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slot.previewUrl}
                alt={
                  "name" in slot && slot.name
                    ? slot.name
                    : `参考图 ${index + 1}`
                }
              />
            ) : (
              <ImagePlus
                className="ead-reference-slot__empty-icon"
                aria-hidden
              />
            )}
            {slot && "name" in slot && slot.name ? (
              <span className="aie-panel__ref-name" title={slot.name}>
                {slot.name}
              </span>
            ) : null}
          </button>
          {slot ? (
            <button
              type="button"
              className="ead-reference-slot__remove aie-panel__ref-clear"
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
            data-testid={`aie-reference-slot-file-${index + 1}`}
            onChange={(e) => handleSlotUpload(index, e.target.files)}
          />
        </div>
      ))}
    </div>
  );

  const stopBackdropClose = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);

  const activeSlot =
    slotMenuIndex == null ? null : (referenceSlots[slotMenuIndex] ?? null);
  const slotActionMenu =
    slotMenuIndex != null && slotMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="aie-panel__slot-menu-mask"
              aria-label="关闭参考图菜单"
              data-testid={`aie-reference-slot-menu-mask-${slotMenuIndex + 1}`}
              onClick={(event) => {
                stopBackdropClose(event);
                closeSlotMenu();
              }}
            />
            <div
              className="aie-panel__slot-menu aie-panel__slot-menu--portal"
              data-testid={`aie-reference-slot-menu-${slotMenuIndex + 1}`}
              role="menu"
              onClick={stopBackdropClose}
              onMouseDown={stopBackdropClose}
              style={{
                top: slotMenuPosition.top,
                left: slotMenuPosition.left,
              }}
            >
              <button
                type="button"
                role="menuitem"
                data-testid={`aie-slot-menu-upload-${slotMenuIndex + 1}`}
                onClick={(event) => {
                  stopBackdropClose(event);
                  const index = slotMenuIndex;
                  closeSlotMenu();
                  fileInputRefs.current[index]?.click();
                }}
              >
                上传图片
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid={`aie-slot-menu-library-${slotMenuIndex + 1}`}
                onClick={(event) => {
                  stopBackdropClose(event);
                  const index = slotMenuIndex;
                  closeSlotMenu();
                  onPickMaterialLibrary?.(index);
                }}
              >
                引用素材库
              </button>
              {activeSlot ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`aie-slot-menu-delete-${slotMenuIndex + 1}`}
                  onClick={(event) => {
                    stopBackdropClose(event);
                    removeSlot(slotMenuIndex);
                  }}
                >
                  删除
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                data-testid={`aie-slot-menu-cancel-${slotMenuIndex + 1}`}
                onClick={(event) => {
                  stopBackdropClose(event);
                  closeSlotMenu();
                }}
              >
                取消
              </button>
            </div>
          </>,
          document.body,
        )
      : null;

  const historyBlock =
    historyUiEnabled && showHistory ? (
      <MediaHistoryStrip
        forceShow
        testId="aie-image-history"
        className="ead-design-image-history"
        items={historyIds.map((id) => ({
          id,
          thumbUrl: historyThumbUrl(id),
          title: id,
        }))}
        activeId={currentMediaId}
        disabled={generateBusy}
        onSelect={onSelectHistory}
      />
    ) : null;

  const statusBlock = (
    <>
      {notice ? (
        <p className="ead-muted" role="status" data-testid="aie-notice">
          {notice}
        </p>
      ) : null}
      {uploadError || error ? (
        <p className="ead-error" role="alert" data-testid="aie-error">
          {uploadError || error}
        </p>
      ) : null}
    </>
  );

  const lookPreview = (
    <div
      className="character-look-editor__preview aie-preview-stage"
      data-testid="character-look-preview"
    >
      <div
        className="character-look-editor__preview-frame aie-preview-stage"
        data-testid="aie-image-preview"
      >
        {previewLoading ? (
          <p className="ead-muted">正在加载预览…</p>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="character-look-editor__preview-image"
            src={previewUrl}
            alt="当前预览"
          />
        ) : (
          <p className="ead-muted character-look-editor__preview-empty">
            {resolvedEmptyPreview}
          </p>
        )}
        {generateBusy && generationProgress ? (
          <DesignGenerationOverlay progress={generationProgress} />
        ) : null}
        {onPrecheck ? (
          <button
            type="button"
            className={`amw-btn ead-modal__icon-btn character-look-editor__precheck${
              precheckCertified ? " is-verified" : ""
            }`}
            data-testid="character-look-precheck"
            data-verified={precheckCertified ? "true" : undefined}
            title={
              precheckCertified
                ? "已通过人物校验"
                : "对该造型图片执行人物校验（不会修改主形象）"
            }
            disabled={
              !canPrecheck ||
              precheckBusy ||
              saveBusy ||
              generateBusy ||
              saved ||
              !currentMediaId
            }
            onClick={() => onPrecheck()}
          >
            <ShieldCheck
              className={`h-3.5 w-3.5${
                precheckCertified ? " ead-shield-verified" : ""
              }`}
              aria-hidden
            />
            <span>
              {precheckBusy
                ? "校验中…"
                : precheckCertified
                  ? "已认证"
                  : precheckLabel}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className="ead-modal-backdrop"
      role="presentation"
      data-testid="asset-image-edit-panel"
      data-variant={variant}
      onClick={onClose}
    >
      <div
        className={`ead-modal ead-modal--wide aie-panel${
          isCharacterLook ? " aie-panel--character-look" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ead-modal__head">
          <h2>{title}</h2>
          <button
            type="button"
            className="amw-btn"
            data-testid="aie-close"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        {isCharacterLook ? (
          <div
            className="aie-panel__body aie-panel--character-look__body character-look-editor"
            data-testid="aie-character-look-body"
          >
            <div
              className="character-look-editor__left"
              data-testid="aie-character-look-preview-col"
            >
              <div className="ead-modal__section-head">
                <span>图片预览</span>
                {historyUiEnabled ? (
                  <button
                    type="button"
                    className="amw-btn ead-modal__icon-btn"
                    data-testid="aie-history-toggle"
                    onClick={onToggleHistory}
                  >
                    历史 {historyIds.length > 0 ? historyIds.length : ""}
                  </button>
                ) : null}
              </div>
              {lookPreview}
              {historyBlock}

              {onLookNameChange ? (
                <label className="amw-field character-look-editor__name">
                  <span>造型名称</span>
                  <input
                    className="amw-input"
                    data-testid="aie-look-name"
                    placeholder="例如：少年时期 / 受伤状态 / 宴会礼服"
                    value={lookName}
                    disabled={generateBusy}
                    onChange={(e) => onLookNameChange(e.target.value)}
                    onBlur={() => onLookNameBlur?.()}
                  />
                </label>
              ) : null}
              {inheritHint ? (
                <p className="amw-hint" data-testid="aie-look-inherit-hint">
                  {inheritHint}
                </p>
              ) : null}
              {statusBlock}
            </div>

            <div
              className="character-look-editor__right"
              data-testid="aie-character-look-refs-col"
            >
              {enableMaterialLibraryPick ? (
                <p
                  className="amw-hint aie-panel__refs-hint"
                  data-testid="aie-reference-slots-hint"
                >
                  点击参考图槽位，可上传图片或引用素材库
                </p>
              ) : null}
              {referenceSlotsBlock}

              <label
                className={`amw-field character-look-editor__prompt${
                  fieldErrors?.prompt ? " is-field-error" : ""
                }`}
              >
                <span>{resolvedPromptLabel}</span>
                <textarea
                  className={`amw-textarea aie-panel__edit-prompt character-look-editor__prompt-textarea${
                    fieldErrors?.prompt ? " is-field-error" : ""
                  }`}
                  data-testid="aie-edit-prompt"
                  data-invalid={fieldErrors?.prompt ? "true" : undefined}
                  disabled={generateBusy}
                  placeholder={resolvedPromptPlaceholder}
                  value={imageEditPrompt}
                  onChange={(e) => onImageEditPromptChange(e.target.value)}
                />
              </label>

              <div
                className="character-look-editor__footer character-look-editor__foot aie-panel__foot"
                data-testid="character-look-editor-foot"
              >
                {generationSummary ? (
                  <span
                    className="character-look-editor__summary"
                    data-testid="character-look-generation-summary"
                  >
                    {generationSummary}
                  </span>
                ) : (
                  <span className="character-look-editor__summary" aria-hidden />
                )}
                <div
                  className="character-look-editor__actions character-look-editor__foot-actions"
                  data-testid="character-look-editor-actions"
                >
                  <GenerationParamsPopover
                    open={paramsOpen}
                    onOpenChange={setParamsOpen}
                    triggerRef={paramsTriggerRef}
                    imageOptions={imageOptions}
                    onImageOptionsChange={onImageOptionsChange}
                    imageModelId={imageModelId}
                    onImageModelIdChange={onImageModelIdChange}
                    disabled={generateBusy}
                    fieldErrors={fieldErrors}
                    testId="character-look-params-popover"
                    trigger={
                      <button
                        type="button"
                        className="amw-btn"
                        data-testid="character-look-adjust-params"
                        ref={paramsTriggerRef}
                        aria-expanded={paramsOpen}
                        disabled={generateBusy || saveBusy || precheckBusy}
                        onClick={() => setParamsOpen((open) => !open)}
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden />
                        调整参数
                      </button>
                    }
                  />
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary"
                    data-testid="aie-generate"
                    disabled={
                      !canGenerate || generateBusy || precheckBusy || saveBusy
                    }
                    onClick={onGenerate}
                  >
                    {generateBusy ? "生成中…" : generateLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
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
                className="ead-preview-frame aie-preview-stage"
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
                {generateBusy && generationProgress ? (
                  <DesignGenerationOverlay progress={generationProgress} />
                ) : null}
              </div>
              {historyBlock}
              {inlineGenerationOptions}
            </div>

            <div className="aie-panel__edit-col">
              <div className="ead-image-edit-panel__head">二次编辑</div>
              {referenceSlotsBlock}

              <label
                className={`amw-field${fieldErrors?.prompt ? " is-field-error" : ""}`}
              >
                <span>{resolvedPromptLabel}</span>
                <textarea
                  className={`amw-textarea${fieldErrors?.prompt ? " is-field-error" : ""}`}
                  data-testid="aie-edit-prompt"
                  data-invalid={fieldErrors?.prompt ? "true" : undefined}
                  rows={8}
                  disabled={generateBusy}
                  placeholder={resolvedPromptPlaceholder}
                  value={imageEditPrompt}
                  onChange={(e) => onImageEditPromptChange(e.target.value)}
                />
              </label>

              {sceneActions}
              {statusBlock}
              <div className="ead-image-edit-panel__foot aie-panel__foot">
                {showCancel ? (
                  <button
                    type="button"
                    className="amw-btn"
                    data-testid="aie-cancel"
                    disabled={generateBusy || saveBusy || precheckBusy}
                    onClick={onClose}
                  >
                    取消
                  </button>
                ) : null}
                {onPrecheck ? (
                  <button
                    type="button"
                    className="amw-btn"
                    data-testid="aie-video-ref-precheck"
                    disabled={
                      !canPrecheck ||
                      precheckBusy ||
                      saveBusy ||
                      generateBusy ||
                      saved
                    }
                    onClick={() => onPrecheck()}
                  >
                    {precheckBusy ? "校验中…" : precheckLabel}
                  </button>
                ) : null}
                {onSave ? (
                  <button
                    type="button"
                    className="amw-btn"
                    data-testid="aie-save"
                    disabled={
                      !canSave ||
                      saveBusy ||
                      generateBusy ||
                      precheckBusy ||
                      saved
                    }
                    onClick={() => onSave()}
                  >
                    {saved ? "已保存" : saveBusy ? "保存中…" : saveLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="amw-btn amw-btn-primary"
                  data-testid="aie-generate"
                  disabled={
                    !canGenerate || generateBusy || precheckBusy || saveBusy
                  }
                  onClick={onGenerate}
                >
                  {generateBusy ? "生成中…" : generateLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {slotActionMenu}
    </div>
  );
}

export {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  DEFAULT_DESIGN_IMAGE_MODEL_ID,
};
