"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { Mic2 } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { glass } from "@/workflow/components/glass-ui";
import {
  filterAssetsByQuery,
  getActiveMentionQuery,
  insertMentionAtCaret,
} from "@/workflow/lib/mention-tokens";
import { useWorkflowStore } from "@/workflow/store";
import type { AssetRecord } from "@/workflow/types";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** glass：节点浮层；dark：属性面板 / 文本节点 */
  variant?: "glass" | "dark";
  rows?: number;
  onKeyDown?: TextareaHTMLAttributes<HTMLTextAreaElement>["onKeyDown"];
};

export function MentionTextarea({
  value,
  onChange,
  onBlur,
  disabled = false,
  placeholder = "输入内容，键入 @ 引用素材库…",
  className = "",
  variant = "glass",
  rows,
  onKeyDown,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const assets = useWorkflowStore((s) => s.document.assets);
  const filtered = useMemo(
    () => (open ? filterAssetsByQuery(assets, query) : EMPTY),
    [open, assets, query],
  );

  const refreshMentionState = useCallback(
    (nextValue: string, caret: number) => {
      const active = getActiveMentionQuery(nextValue, caret);
      if (!active) {
        setOpen(false);
        setQuery("");
        setActiveIndex(0);
        return;
      }
      setOpen(true);
      setQuery(active.query);
      setActiveIndex(0);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open || !areaRef.current || !rootRef.current) {
      setMenuPos(null);
      return;
    }
    const area = areaRef.current;
    const root = rootRef.current;
    const caret = area.selectionStart ?? value.length;
    const coords = getCaretCoordinates(area, caret);
    const rootRect = root.getBoundingClientRect();
    setMenuPos({
      top: Math.min(coords.top + coords.height + 6, root.clientHeight - 8),
      left: Math.min(Math.max(8, coords.left), rootRect.width - 220),
    });
  }, [open, query, value, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const pickAsset = (asset: AssetRecord) => {
    const area = areaRef.current;
    if (!area) return;
    const caret = area.selectionStart ?? value.length;
    const inserted = insertMentionAtCaret(value, caret, asset);
    if (!inserted) return;
    onChange(inserted.next);
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  const baseClass =
    variant === "glass"
      ? glass.textarea
      : "w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        pickAsset(filtered[activeIndex] ?? filtered[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pickAsset(filtered[activeIndex] ?? filtered[0]);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div ref={rootRef} className="relative">
      <textarea
        ref={areaRef}
        className={`nodrag nopan nowheel ${baseClass} ${className}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          refreshMentionState(next, e.target.selectionStart ?? next.length);
        }}
        onClick={(e) => {
          const target = e.currentTarget;
          refreshMentionState(
            target.value,
            target.selectionStart ?? target.value.length,
          );
        }}
        onKeyUp={(e) => {
          if (
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "Home" ||
            e.key === "End"
          ) {
            refreshMentionState(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? 0,
            );
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {open && menuPos && (
        <div
          id={listId}
          role="listbox"
          className={`absolute z-50 w-[220px] max-w-[min(220px,92vw)] ${
            variant === "glass"
              ? glass.popover
              : "rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl"
          }`}
          style={{ top: menuPos.top, left: menuPos.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="mb-1 px-1.5 text-[10px] font-medium text-zinc-500">
            素材库
          </div>
          <div className="max-h-44 space-y-0.5 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-1.5 py-2 text-[10px] text-zinc-400">
                {assets.length === 0
                  ? "素材库为空，请先上传素材"
                  : "没有匹配的素材"}
              </div>
            ) : (
              filtered.map((asset, index) => {
                const active = index === activeIndex;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition ${
                      active
                        ? variant === "glass"
                          ? "bg-white/70"
                          : "bg-zinc-800"
                        : variant === "glass"
                          ? "hover:bg-white/55"
                          : "hover:bg-zinc-800/80"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pickAsset(asset)}
                  >
                    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/40 bg-zinc-200/40">
                      {asset.assetType === "audio" ? (
                        <div className="flex h-full w-full items-center justify-center text-zinc-500">
                          <Mic2 className="h-3.5 w-3.5" />
                        </div>
                      ) : (
                        <AssetThumb
                          src={asset.thumbnailUrl || asset.url}
                          alt={asset.name}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[11px] ${
                          variant === "glass" ? "text-zinc-700" : "text-zinc-200"
                        }`}
                      >
                        {asset.name}
                      </div>
                      <div className="truncate text-[9px] text-zinc-500">
                        {asset.assetType}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY: AssetRecord[] = [];

/** 近似计算 textarea 光标像素位置（相对 textarea 左上角） */
function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(element);
  const props = [
    "direction",
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "whiteSpace",
    "wordBreak",
    "wordWrap",
  ] as const;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.overflowWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";

  for (const prop of props) {
    div.style.setProperty(prop, style.getPropertyValue(prop));
  }
  div.style.width = `${element.clientWidth}px`;

  const text = element.value.slice(0, position);
  div.textContent = text;
  const span = document.createElement("span");
  span.textContent = element.value.slice(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);

  const top = span.offsetTop - element.scrollTop;
  const left = span.offsetLeft - element.scrollLeft;
  const height = Number.parseFloat(style.lineHeight) || span.offsetHeight || 16;
  document.body.removeChild(div);
  return { top, left, height };
}
