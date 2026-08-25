"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";
import {
  MaterialPickerModal,
  type MaterialPickerSelection,
} from "@/materials/ui/MaterialPickerModal";
import { readProjectAssetMediaDrag } from "@/projects/assets/project-asset-media-drag";
import { validateProjectAssetImageFileClient } from "@/projects/assets/upload-asset-image";

export const LIBRARY_COMPACT_REFERENCE_SLOT_COUNT = 6;

export type CompactPromptReferenceSlot =
  | {
      source: "generated";
      mediaId: string;
      previewUrl: string;
      name?: string;
    }
  | {
      source: "upload";
      file: File;
      previewUrl: string;
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

export function filledCompactPromptReferenceSlotCount(
  slots: CompactPromptReferenceSlot[],
): number {
  return slots.filter(Boolean).length;
}

export function emptyCompactPromptReferenceSlots(): CompactPromptReferenceSlot[] {
  return Array.from(
    { length: LIBRARY_COMPACT_REFERENCE_SLOT_COUNT },
    () => null,
  );
}

function revokeUploadPreview(slot: CompactPromptReferenceSlot): void {
  if (slot?.source === "upload" && slot.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(slot.previewUrl);
  }
}

function compactReferenceSlots(
  slots: CompactPromptReferenceSlot[],
): CompactPromptReferenceSlot[] {
  const filled = slots.filter(
    (slot): slot is NonNullable<CompactPromptReferenceSlot> => Boolean(slot),
  );
  return [
    ...filled,
    ...Array.from(
      {
        length: Math.max(0, LIBRARY_COMPACT_REFERENCE_SLOT_COUNT - filled.length),
      },
      () => null,
    ),
  ].slice(0, LIBRARY_COMPACT_REFERENCE_SLOT_COUNT);
}

type Props = {
  projectId: string;
  slots: CompactPromptReferenceSlot[];
  onSlotsChange: (slots: CompactPromptReferenceSlot[]) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
};

export function CompactPromptReferenceSlots({
  projectId,
  slots,
  onSlotsChange,
  disabled = false,
  onError,
}: Props) {
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const slotHitRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [slotMenuIndex, setSlotMenuIndex] = useState<number | null>(null);
  const [slotMenuPosition, setSlotMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);

  const usedPersonalMaterialIds = useMemo(
    () =>
      slots.flatMap((slot) =>
        slot &&
        (slot.source === "personal-material" || slot.source === "system-material")
          ? [slot.personalMaterialId]
          : [],
      ),
    [slots],
  );
  const usedSystemMaterialIds = useMemo(
    () =>
      slots.flatMap((slot) =>
        slot?.source === "system-material" ? [slot.materialId] : [],
      ),
    [slots],
  );
  const filledCount = useMemo(
    () => filledCompactPromptReferenceSlotCount(slots),
    [slots],
  );

  const closeSlotMenu = useCallback(() => {
    setSlotMenuIndex(null);
    setSlotMenuPosition(null);
  }, []);

  useEffect(() => {
    if (slotMenuIndex == null) return;
    const updatePosition = () => {
      const anchor = slotHitRefs.current[slotMenuIndex];
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setSlotMenuPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
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

  const assignSlot = useCallback(
    (
      clickIndex: number,
      nextSlot: NonNullable<CompactPromptReferenceSlot>,
    ) => {
      onSlotsChange(
        compactReferenceSlots(
          (() => {
            const next = [...slots];
            const firstEmpty = next.findIndex((slot) => !slot);
            const target =
              next[clickIndex] != null
                ? clickIndex
                : firstEmpty === -1
                  ? clickIndex
                  : clickIndex > firstEmpty
                    ? firstEmpty
                    : clickIndex;
            revokeUploadPreview(next[target] ?? null);
            next[target] = nextSlot;
            return next;
          })(),
        ),
      );
    },
    [onSlotsChange, slots],
  );

  const handleSlotUpload = useCallback(
    (clickIndex: number, fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      const validationError = validateProjectAssetImageFileClient(file);
      if (validationError) {
        onError?.(validationError);
        return;
      }
      assignSlot(clickIndex, {
        source: "upload",
        file,
        previewUrl: URL.createObjectURL(file),
      });
      const input = fileInputRefs.current[clickIndex];
      if (input) input.value = "";
      closeSlotMenu();
    },
    [assignSlot, closeSlotMenu, onError],
  );

  const removeSlot = useCallback(
    (index: number) => {
      onSlotsChange(
        compactReferenceSlots(
          (() => {
            const next = [...slots];
            revokeUploadPreview(next[index] ?? null);
            next[index] = null;
            return next;
          })(),
        ),
      );
      closeSlotMenu();
    },
    [closeSlotMenu, onSlotsChange, slots],
  );

  const handleDrop = useCallback(
    (index: number, event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readProjectAssetMediaDrag(event.dataTransfer);
      if (!payload) return;
      if (payload.projectId !== projectId) {
        onError?.("只能使用当前项目内的图片作为参考。");
        return;
      }
      assignSlot(index, {
        source: "generated",
        mediaId: payload.mediaId,
        previewUrl: payload.previewUrl,
        name: payload.label,
      });
    },
    [assignSlot, onError, projectId],
  );

  const openSlotMenu = useCallback(
    (index: number) => {
      if (disabled) return;
      const anchor = slotHitRefs.current[index];
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        setSlotMenuPosition({
          top: rect.top + rect.height / 2,
          left: rect.right + 8,
        });
      }
      setSlotMenuIndex(index);
    },
    [disabled],
  );

  const handleMaterialPick = useCallback(
    (selection: MaterialPickerSelection) => {
      if (pickerSlotIndex == null) return;
      if (selection.source === "personal-material") {
        assignSlot(pickerSlotIndex, {
          source: "personal-material",
          personalMaterialId: selection.personalMaterialId,
          mediaId: selection.mediaId,
          previewUrl: selection.previewUrl,
          name: selection.name,
        });
      } else {
        assignSlot(pickerSlotIndex, {
          source: "system-material",
          materialId: selection.materialId ?? selection.personalMaterialId,
          personalMaterialId: selection.personalMaterialId,
          mediaId: selection.mediaId,
          previewUrl: selection.previewUrl,
          name: selection.name,
        });
      }
      setPickerSlotIndex(null);
    },
    [assignSlot, pickerSlotIndex],
  );

  const stopBackdropClose = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);

  const activeSlot =
    slotMenuIndex == null ? null : (slots[slotMenuIndex] ?? null);
  const slotActionMenu =
    slotMenuIndex != null && slotMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="aie-panel__slot-menu-mask"
              aria-label="关闭参考图菜单"
              data-testid={`character-prompt-ref-menu-mask-${slotMenuIndex + 1}`}
              onClick={(event) => {
                stopBackdropClose(event);
                closeSlotMenu();
              }}
            />
            <div
              className="aie-panel__slot-menu aie-panel__slot-menu--portal character-prompt-reference-slots__menu"
              data-testid={`character-prompt-ref-menu-${slotMenuIndex + 1}`}
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
                data-testid={`character-prompt-ref-local-${slotMenuIndex + 1}`}
                onClick={(event) => {
                  stopBackdropClose(event);
                  const index = slotMenuIndex;
                  closeSlotMenu();
                  fileInputRefs.current[index]?.click();
                }}
              >
                本地上传
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid={`character-prompt-ref-personal-${slotMenuIndex + 1}`}
                onClick={(event) => {
                  stopBackdropClose(event);
                  const index = slotMenuIndex;
                  closeSlotMenu();
                  setPickerSlotIndex(index);
                }}
              >
                个人素材
              </button>
              {activeSlot ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`character-prompt-ref-delete-${slotMenuIndex + 1}`}
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
                data-testid={`character-prompt-ref-cancel-${slotMenuIndex + 1}`}
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

  return (
    <>
      <div
        className="character-prompt-reference-slots"
        data-testid="character-prompt-reference-slots"
      >
        <div className="character-prompt-reference-slots__items">
          {slots.map((slot, index) => (
            <div
              key={`character-prompt-ref-${index}`}
              className={`ead-reference-slot${slot ? " is-filled" : ""}${
                disabled ? " is-disabled" : ""
              }`}
              data-testid={`character-prompt-reference-slot-${index + 1}`}
              onDragEnter={(event) => {
                event.preventDefault();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => handleDrop(index, event)}
            >
              <button
                type="button"
                ref={(el) => {
                  slotHitRefs.current[index] = el;
                }}
                className="ead-reference-slot__hit"
                disabled={disabled}
                title={
                  slot
                    ? `替换第${index + 1}张参考图`
                    : `上传或拖入第${index + 1}张参考图`
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
              </button>
              {slot ? (
                <button
                  type="button"
                  className="ead-reference-slot__remove"
                  data-testid={`character-prompt-reference-remove-${index + 1}`}
                  title={`删除第${index + 1}张参考图`}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
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
                data-testid={`character-prompt-reference-file-${index + 1}`}
                onChange={(event) =>
                  handleSlotUpload(index, event.target.files)
                }
              />
            </div>
          ))}
        </div>
        <span
          className="character-prompt-reference-slots__counter"
          data-testid="character-prompt-reference-counter"
          aria-live="polite"
        >
          {filledCount}/{LIBRARY_COMPACT_REFERENCE_SLOT_COUNT}
        </span>
      </div>
      {slotActionMenu}
      <MaterialPickerModal
        open={pickerSlotIndex != null}
        onClose={() => setPickerSlotIndex(null)}
        onSelect={handleMaterialPick}
        slotIndex={pickerSlotIndex == null ? null : pickerSlotIndex + 1}
        usedPersonalMaterialIds={usedPersonalMaterialIds}
        usedSystemMaterialIds={usedSystemMaterialIds}
        preventDuplicate
      />
    </>
  );
}
