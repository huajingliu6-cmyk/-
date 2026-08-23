"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DESIGN_IMAGE_ASPECT_RATIOS,
  DESIGN_IMAGE_ASPECT_RATIO_LABELS,
  DESIGN_IMAGE_COUNTS,
  DESIGN_IMAGE_QUALITIES,
  DESIGN_IMAGE_QUALITY_LABELS,
  type DesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";
import {
  DESIGN_IMAGE_MODELS,
  isDesignImageModelId,
  type DesignImageModelId,
} from "@/projects/assets/episode-design/image-generation-models";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

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

export type GenerationParamsFieldsProps = {
  imageOptions: DesignImageGenerationOptions;
  onImageOptionsChange: (value: DesignImageGenerationOptions) => void;
  imageModelId: DesignImageModelId;
  onImageModelIdChange: (value: DesignImageModelId) => void;
  disabled?: boolean;
  fieldErrors?: { model?: boolean };
  testIdPrefix?: string;
};

/** Shared 2×2 (mobile 1-col) generation option fields used by design + look editors. */
export function GenerationParamsFields({
  imageOptions,
  onImageOptionsChange,
  imageModelId,
  onImageModelIdChange,
  disabled = false,
  fieldErrors,
  testIdPrefix = "generation-params",
}: GenerationParamsFieldsProps) {
  return (
    <div
      className="ead-generation-options prompt-params-grid"
      data-testid={`${testIdPrefix}-fields`}
    >
      <div className="ead-generation-option">
        <GlassSelect
          label="画质"
          value={imageOptions.quality}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
}

export type GenerationParamsPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  imageOptions: DesignImageGenerationOptions;
  onImageOptionsChange: (value: DesignImageGenerationOptions) => void;
  imageModelId: DesignImageModelId;
  onImageModelIdChange: (value: DesignImageModelId) => void;
  disabled?: boolean;
  fieldErrors?: { model?: boolean };
  testId?: string;
};

/**
 * Fixed portal popover matching DesignAssetModal param interaction:
 * Escape closes Select first, then popover; Select clicks do not dismiss.
 */
export function GenerationParamsPopover({
  open,
  onOpenChange,
  trigger,
  triggerRef,
  imageOptions,
  onImageOptionsChange,
  imageModelId,
  onImageModelIdChange,
  disabled,
  fieldErrors,
  testId = "generation-params-popover",
}: GenerationParamsPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const placePanel = useCallback(() => {
    const triggerEl = triggerRef.current;
    const panel = panelRef.current;
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    let left = rect.right - width;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const panelH = Math.max(panel?.offsetHeight || 0, 280);
    let top = rect.bottom + 8;
    if (top + panelH > window.innerHeight - 12) {
      top = rect.top - panelH - 8;
    }
    top = Math.max(12, Math.min(top, window.innerHeight - panelH - 12));
    setPanelStyle({
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
    });
    setPlaced(true);
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPlaced(false);
      return;
    }
    placePanel();
    const raf = window.requestAnimationFrame(() => placePanel());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".gs__menu--portal, .gs__menu")) return;
      onOpenChange(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      const el = target instanceof Element ? target : null;
      if (
        el?.closest?.(
          ".gs__menu, .gs__menu--portal, [role='listbox'], [data-glass-select-menu]",
        )
      ) {
        return;
      }
      onOpenChange(false);
    };
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange, placePanel, triggerRef]);

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className={`prompt-params-popover parameter-popover${
                placed ? " is-placed" : ""
              }`}
              data-testid={testId}
              style={panelStyle}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="prompt-params-popover__title">调整生成参数</div>
              <GenerationParamsFields
                imageOptions={imageOptions}
                onImageOptionsChange={onImageOptionsChange}
                imageModelId={imageModelId}
                onImageModelIdChange={onImageModelIdChange}
                disabled={disabled}
                fieldErrors={fieldErrors}
                testIdPrefix={testId}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
