"use client";

/**
 * Global glass select — underlying dropdown primitive for the app shell.
 * Prefer this over native <select> and one-off custom menus.
 *
 * Variants:
 * - default: dark form control (story / assets / settings)
 * - toolbar: light compact pill (workflow float bars)
 * - compact: dark compact control (node cards)
 *
 * Set `menuPortal` to mount the menu on document.body with fixed positioning
 * (avoids clipping inside overflow / modal scroll containers).
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { prefersReducedMotion } from "@/shell/login-portal";
import { useChipBounce } from "@/shell/useChipBounce";
import type {
  GlassSelectGroup,
  GlassSelectOption,
} from "@/shell/glass-select/types";
import "@/shell/glass-select/glass-select.css";

export type { GlassSelectGroup, GlassSelectOption } from "@/shell/glass-select/types";

export type GlassSelectVariant = "default" | "toolbar" | "compact";

type MenuPlacement = "bottom" | "top";

type MenuPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: MenuPlacement;
};

type Props = {
  /** Flat options (ignored when `groups` is provided) */
  options?: GlassSelectOption[];
  /** Grouped options (e.g. project voices + system voices) */
  groups?: GlassSelectGroup[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  label: string;
  /** Visually hide label (still exposed to AT). Auto for toolbar/compact. */
  hideLabel?: boolean;
  placeholder?: string;
  /** Native title / tooltip on the trigger */
  title?: string;
  /** Allow clearing selection; emits empty string */
  allowClear?: boolean;
  clearLabel?: string;
  /** Add top margin (story workspace form rhythm) */
  spaced?: boolean;
  /**
   * default — dark form field
   * toolbar — light pill for workflow float bars
   * compact — dark dense control for node cards
   */
  variant?: GlassSelectVariant;
  /** Optional leading icon inside the trigger (toolbar) */
  leadingIcon?: ReactNode;
  className?: string;
  /** Extra class names for the dropdown menu panel */
  menuClassName?: string;
  /** Extra class names for each option row */
  optionClassName?: string;
  /**
   * Mount menu via portal to document.body with position:fixed.
   * Use inside modals / overflow containers so options are not clipped.
   */
  menuPortal?: boolean;
  /** Gap between trigger and menu when portaled (px). Default 6. */
  menuSideOffset?: number;
  /** Viewport edge padding when portaled (px). Default 12. */
  menuCollisionPadding?: number;
  onOpen?: () => void;
  /** Fires when open state changes (after open / after finish close). */
  onOpenChange?: (open: boolean) => void;
};

const CLOSE_MS = 220;
const DEFAULT_SIDE_OFFSET = 6;
const DEFAULT_COLLISION_PADDING = 12;
const MENU_MAX_HEIGHT = 320;

function flattenOptions(
  options: GlassSelectOption[] | undefined,
  groups: GlassSelectGroup[] | undefined,
): GlassSelectOption[] {
  if (groups && groups.length > 0) {
    return groups.flatMap((g) => g.options);
  }
  return options ?? [];
}

function computeMenuPosition(
  trigger: DOMRect,
  opts: {
    sideOffset: number;
    collisionPadding: number;
    preferredMaxHeight: number;
  },
): MenuPosition {
  const { sideOffset, collisionPadding, preferredMaxHeight } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(trigger.width, vw - collisionPadding * 2);
  const left = Math.min(
    Math.max(trigger.left, collisionPadding),
    vw - collisionPadding - width,
  );

  const spaceBelow = vh - trigger.bottom - sideOffset - collisionPadding;
  const spaceAbove = trigger.top - sideOffset - collisionPadding;
  const placeBottom =
    spaceBelow >= Math.min(preferredMaxHeight, 160) || spaceBelow >= spaceAbove;

  if (placeBottom) {
    const maxHeight = Math.max(
      80,
      Math.min(preferredMaxHeight, spaceBelow),
    );
    return {
      top: trigger.bottom + sideOffset,
      left,
      width,
      maxHeight,
      placement: "bottom",
    };
  }

  const maxHeight = Math.max(80, Math.min(preferredMaxHeight, spaceAbove));
  return {
    bottom: vh - trigger.top + sideOffset,
    left,
    width,
    maxHeight,
    placement: "top",
  };
}

export function GlassSelect({
  options,
  groups,
  value,
  onChange,
  disabled = false,
  id,
  label,
  hideLabel,
  placeholder = "请选择",
  title,
  allowClear = false,
  clearLabel = "清除选择",
  spaced = false,
  variant = "default",
  leadingIcon,
  className = "",
  menuClassName = "",
  optionClassName = "",
  menuPortal = false,
  menuSideOffset = DEFAULT_SIDE_OFFSET,
  menuCollisionPadding = DEFAULT_COLLISION_PADDING,
  onOpen,
  onOpenChange,
}: Props) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listboxId = `${autoId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const bounce = useChipBounce();

  const isDense = variant === "toolbar" || variant === "compact";
  const labelHidden = hideLabel ?? isDense;
  const chevronSize = isDense ? 14 : 18;
  const checkSize = isDense ? 14 : 16;

  const flatOptions = useMemo(
    () => flattenOptions(options, groups),
    [groups, options],
  );

  const selected = flatOptions.find((o) => o.id === value) ?? null;
  const selectedIndex = flatOptions.findIndex((o) => o.id === value);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    setClosing(false);
    setOpen(false);
    setMenuPosition(null);
    clearCloseTimer();
    onOpenChange?.(false);
  }, [clearCloseTimer, onOpenChange]);

  const requestClose = useCallback(() => {
    if (!open || closing) return;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    setClosing(true);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, CLOSE_MS);
  }, [clearCloseTimer, closing, finishClose, open]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    onOpen?.();
    clearCloseTimer();
    setClosing(false);
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
    onOpenChange?.(true);
  }, [clearCloseTimer, disabled, onOpen, onOpenChange, selectedIndex]);

  const toggleMenu = useCallback(() => {
    bounce.trigger();
    if (open && !closing) {
      requestClose();
    } else if (!open) {
      openMenu();
    }
  }, [bounce, closing, open, openMenu, requestClose]);

  const selectOption = useCallback(
    (optionId: string) => {
      onChange(optionId);
      requestClose();
      triggerRef.current?.focus();
    },
    [onChange, requestClose],
  );

  const updateMenuPosition = useCallback(() => {
    if (!menuPortal) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuPosition(
      computeMenuPosition(trigger.getBoundingClientRect(), {
        sideOffset: menuSideOffset,
        collisionPadding: menuCollisionPadding,
        preferredMaxHeight: MENU_MAX_HEIGHT,
      }),
    );
  }, [menuCollisionPadding, menuPortal, menuSideOffset]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!menuPortal || !open) return;
    updateMenuPosition();
  }, [menuPortal, open, updateMenuPosition, flatOptions.length]);

  useEffect(() => {
    if (!menuPortal || !open || closing) return;
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    // Capture scroll from nested overflow containers (modal body, etc.)
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [closing, menuPortal, open, updateMenuPosition]);

  useEffect(() => {
    if (!open || closing) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inRoot = rootRef.current?.contains(target) ?? false;
      const inMenu = menuRef.current?.contains(target) ?? false;
      if (!inRoot && !inMenu) {
        requestClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [closing, open, requestClose]);

  useEffect(() => {
    if (!open || closing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      triggerRef.current?.focus();
    };
    // Capture so nested dialog document listeners do not close the host first.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closing, open, requestClose]);

  useEffect(() => {
    if (!open || closing) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [closing, highlightIndex, open]);

  const moveHighlight = useCallback(
    (delta: number) => {
      setHighlightIndex((prev) => {
        if (flatOptions.length === 0) return 0;
        return (prev + delta + flatOptions.length) % flatOptions.length;
      });
    },
    [flatOptions.length],
  );

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const option = flatOptions[highlightIndex];
      if (option) selectOption(option.id);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      triggerRef.current?.focus();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = flatOptions[highlightIndex];
      if (option) selectOption(option.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      triggerRef.current?.focus();
    }
  };

  const menuVisible = open || closing;
  const useGroups = Boolean(groups && groups.length > 0);

  const renderOption = (option: GlassSelectOption, flatIndex: number) => {
    const isSelected = option.id === value;
    const isActive = flatIndex === highlightIndex;
    const compactOption = !option.description;
    const optionKey = option.id === "" ? `${listboxId}-empty` : option.id;
    return (
      <div
        key={optionKey}
        ref={(el) => {
          optionRefs.current[flatIndex] = el;
        }}
        role="option"
        aria-selected={isSelected}
        id={`${listboxId}-opt-${optionKey}`}
        className={`gs__option${compactOption ? " is-compact" : ""}${
          isSelected ? " is-selected" : ""
        }${isActive ? " is-active" : ""}${
          optionClassName ? ` ${optionClassName}` : ""
        }`}
        data-highlighted={isActive ? "" : undefined}
        data-state={isSelected ? "checked" : "unchecked"}
        onMouseEnter={() => setHighlightIndex(flatIndex)}
        onClick={() => selectOption(option.id)}
      >
        <div className="gs__option-body">
          <div className="gs__option-name">{option.label}</div>
          {option.description ? (
            <div className="gs__option-desc">{option.description}</div>
          ) : null}
        </div>
        {isSelected ? (
          <span className="gs__check" aria-hidden>
            <Check size={checkSize} strokeWidth={2.5} />
          </span>
        ) : (
          <span className="gs__mark" aria-hidden />
        )}
      </div>
    );
  };

  let flatCursor = 0;
  const variantClass =
    variant === "toolbar"
      ? " gs--toolbar"
      : variant === "compact"
        ? " gs--compact"
        : "";

  const portalMenuStyle: CSSProperties | undefined =
    menuPortal && menuPosition
      ? {
          position: "fixed",
          top: menuPosition.top,
          bottom: menuPosition.bottom,
          left: menuPosition.left,
          width: menuPosition.width,
          minWidth: menuPosition.width,
          maxHeight: menuPosition.maxHeight,
          zIndex: 2600,
          ["--radix-select-trigger-width" as string]: `${menuPosition.width}px`,
          ["--radix-select-content-available-height" as string]: `${menuPosition.maxHeight}px`,
        }
      : undefined;

  const menuNode = menuVisible ? (
    <div
      ref={menuRef}
      id={listboxId}
      className={`gs__menu${menuPortal ? " gs__menu--portal" : ""}${
        menuPosition?.placement === "top" ? " gs__menu--top" : ""
      }${closing ? " is-closing" : ""}${menuClassName ? ` ${menuClassName}` : ""}`}
      role="listbox"
      aria-label={label}
      tabIndex={-1}
      style={portalMenuStyle}
      data-side={menuPosition?.placement ?? "bottom"}
      onKeyDown={onListKeyDown}
      onMouseDown={(event) => {
        // Keep focus/selection behavior stable; avoid backdrop click-close races.
        event.stopPropagation();
      }}
    >
      {useGroups
        ? groups!.map((group) => {
            const start = flatCursor;
            const nodes = group.options.map((option, i) =>
              renderOption(option, start + i),
            );
            flatCursor += group.options.length;
            return (
              <div key={group.id} className="gs__group">
                <p className="gs__group-title">{group.label}</p>
                {group.options.length === 0 ? (
                  <p className="gs__empty">
                    {group.emptyHint ?? "暂无选项"}
                  </p>
                ) : (
                  nodes
                )}
              </div>
            );
          })
        : flatOptions.map((option, index) => renderOption(option, index))}
      {allowClear && value ? (
        <button
          type="button"
          className="gs__clear"
          onClick={() => selectOption("")}
        >
          {clearLabel}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className={`gs${variantClass}${spaced ? " gs--spaced" : ""}${
        className ? ` ${className}` : ""
      }${isDense ? " nodrag nopan" : ""}`}
      ref={rootRef}
      onMouseDown={(event) => {
        if (isDense) event.stopPropagation();
      }}
    >
      {labelHidden ? (
        <span className="gs__sr-only" id={`${autoId}-label`}>
          {label}
        </span>
      ) : (
        <label className="gs__label" htmlFor={triggerId}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        title={title}
        className={`gs__trigger ${bounce.bounceClass}${
          open && !closing ? " is-open" : ""
        }`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open && !closing}
        aria-controls={listboxId}
        aria-labelledby={labelHidden ? `${autoId}-label` : undefined}
        onClick={toggleMenu}
        onKeyDown={onTriggerKeyDown}
        onAnimationEnd={bounce.onAnimationEnd}
      >
        {leadingIcon ? (
          <span className="gs__leading" aria-hidden>
            {leadingIcon}
          </span>
        ) : null}
        <span
          className={`gs__trigger-text${selected ? "" : " is-placeholder"}`}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="gs__chevron" aria-hidden size={chevronSize} />
      </button>

      {menuPortal
        ? menuNode && typeof document !== "undefined"
          ? createPortal(menuNode, document.body)
          : null
        : menuNode}
    </div>
  );
}
