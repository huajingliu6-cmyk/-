"use client";

/**
 * Global glass select — underlying dropdown primitive for the app shell.
 * Prefer this over native <select> and one-off custom menus.
 *
 * Variants:
 * - default: dark form control (story / assets / settings)
 * - toolbar: light compact pill (workflow float bars)
 * - compact: dark compact control (node cards)
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
  onOpen?: () => void;
};

const CLOSE_MS = 220;

function flattenOptions(
  options: GlassSelectOption[] | undefined,
  groups: GlassSelectGroup[] | undefined,
): GlassSelectOption[] {
  if (groups && groups.length > 0) {
    return groups.flatMap((g) => g.options);
  }
  return options ?? [];
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
  onOpen,
}: Props) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listboxId = `${autoId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
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
    clearCloseTimer();
  }, [clearCloseTimer]);

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
  }, [clearCloseTimer, disabled, onOpen, selectedIndex]);

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

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!open || closing) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        requestClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
      requestClose();
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
        }${isActive ? " is-active" : ""}`}
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

      {menuVisible ? (
        <div
          id={listboxId}
          className={`gs__menu${closing ? " is-closing" : ""}`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
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
      ) : null}
    </div>
  );
}
