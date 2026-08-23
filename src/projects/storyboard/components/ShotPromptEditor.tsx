"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { parsePromptImageSegments } from "@/projects/storyboard/services/shot-prompt-mount";

type Props = {
  value: string;
  disabled?: boolean;
  /** Read-only display: not editable, but not visually "disabled"/dimmed. */
  readOnly?: boolean;
  imageUrlById: Map<string, string>;
  /** 本镜头已添加的素材，可作为 @ 挂载范围 */
  mentionAssets: PickerAsset[];
  onChange: (next: string) => void;
};

type MentionState = {
  query: string;
  /** 序列化文本中 @ / ＠ 的起始下标 */
  start: number;
  /** 序列化文本中光标下标 */
  caret: number;
};

const KIND_LABEL: Record<PickerAsset["kind"], string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

const AT_CHARS = new Set(["@", "＠"]);

function buildEditorHtml(
  prompt: string,
  imageUrlById: Map<string, string>,
): string {
  const segments = parsePromptImageSegments(prompt);
  if (segments.length === 0) {
    return escapeHtml(prompt).replace(/\n/g, "<br>");
  }
  return segments
    .map((seg) => {
      if (seg.type === "text") {
        return escapeHtml(seg.value).replace(/\n/g, "<br>");
      }
      const url = imageUrlById.get(seg.assetId);
      const name = escapeAttr(seg.name);
      const id = escapeAttr(seg.assetId);
      if (url) {
        return `<img class="sbw-prompt-editor__img" src="${escapeAttr(url)}" alt="${name}" data-asset-id="${id}" data-asset-name="${name}" contenteditable="false" />`;
      }
      return `<span class="sbw-prompt-editor__fallback" data-asset-id="${id}" data-asset-name="${name}" contenteditable="false">${escapeHtml(seg.name)}</span>`;
    })
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function serializeEditor(root: HTMLElement): string {
  let out = "";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u200b/g, "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.assetId && el.dataset.assetName) {
      out += `【图:${el.dataset.assetId}:${el.dataset.assetName}】`;
      return;
    }
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    if (el.tagName === "DIV" || el.tagName === "P") {
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
      Array.from(el.childNodes).forEach(walk);
      if (!out.endsWith("\n")) out += "\n";
      return;
    }
    Array.from(el.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  return out.replace(/\n{3,}/g, "\n\n");
}

function isAssetChip(node: Node | null | undefined): node is HTMLElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    Boolean((node as HTMLElement).dataset?.assetId)
  );
}

function isZwspOnlyText(node: Node | null | undefined): boolean {
  return (
    !!node &&
    node.nodeType === Node.TEXT_NODE &&
    (node.textContent ?? "").replace(/\u200b/g, "").length === 0
  );
}

/** 光标紧贴芯片后方（含中间仅有零宽空格）时，Backspace 可删 */
export function findAssetChipBeforeCaret(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  if (!sel.isCollapsed) {
    const node = sel.anchorNode;
    if (isAssetChip(node)) return node;
    if (node?.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset?.assetId) return el;
      const chip = el.closest?.("[data-asset-id]");
      if (chip && root.contains(chip)) return chip as HTMLElement;
    }
    // 选区覆盖芯片
    const range = sel.getRangeAt(0);
    const chips = root.querySelectorAll("[data-asset-id]");
    for (const chip of chips) {
      if (range.intersectsNode(chip)) return chip as HTMLElement;
    }
    return null;
  }

  const { startContainer, startOffset } = sel.getRangeAt(0);
  if (!root.contains(startContainer)) return null;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const before = (startContainer.textContent ?? "").slice(0, startOffset);
    if (before.replace(/\u200b/g, "").length > 0) return null;
    let prev: Node | null = startContainer.previousSibling;
    while (isZwspOnlyText(prev)) prev = prev!.previousSibling;
    return isAssetChip(prev) ? prev : null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    if (isAssetChip(startContainer)) return startContainer as HTMLElement;
    const kids = Array.from(startContainer.childNodes);
    let i = startOffset - 1;
    while (i >= 0 && isZwspOnlyText(kids[i]!)) i -= 1;
    const prev = i >= 0 ? kids[i] : null;
    return isAssetChip(prev) ? prev : null;
  }
  return null;
}

/** 光标紧贴芯片前方时，Delete 可删 */
export function findAssetChipAfterCaret(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const { startContainer, startOffset } = sel.getRangeAt(0);
  if (!root.contains(startContainer)) return null;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? "";
    const after = text.slice(startOffset);
    if (after.replace(/\u200b/g, "").length > 0) return null;
    let next: Node | null = startContainer.nextSibling;
    while (isZwspOnlyText(next)) next = next!.nextSibling;
    return isAssetChip(next) ? next : null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const kids = Array.from(startContainer.childNodes);
    let i = startOffset;
    while (i < kids.length && isZwspOnlyText(kids[i]!)) i += 1;
    const next = i < kids.length ? kids[i] : null;
    return isAssetChip(next) ? next : null;
  }
  return null;
}

function removeAssetChip(chip: HTMLElement): void {
  const parent = chip.parentNode;
  if (!parent) return;

  const before = chip.previousSibling;
  const after = chip.nextSibling;
  const caretHost = document.createTextNode("\u200b");
  parent.insertBefore(caretHost, chip);
  parent.removeChild(chip);

  if (isZwspOnlyText(before) && before !== caretHost) {
    before?.parentNode?.removeChild(before);
  }
  if (isZwspOnlyText(after) && after !== caretHost) {
    // 保留一个零宽占位即可
    after?.parentNode?.removeChild(after);
  }

  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.setStart(caretHost, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}


/**
 * 与 serializeEditor 一致地计算光标在序列化文本中的下标。
 */
export function getSerializeCaretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const { startContainer, startOffset } = sel.getRangeAt(0);
  if (!root.contains(startContainer)) return null;

  let out = "";
  let result: number | null = null;

  const walk = (node: Node): boolean => {
    if (result !== null) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      if (node === startContainer) {
        out += (node.textContent ?? "").slice(0, startOffset);
        result = out.length;
        return true;
      }
      out += node.textContent ?? "";
      return false;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;

    if (el.dataset.assetId && el.dataset.assetName) {
      const token = `【图:${el.dataset.assetId}:${el.dataset.assetName}】`;
      if (el === startContainer || el.contains(startContainer)) {
        out += token;
        result = out.length;
        return true;
      }
      out += token;
      return false;
    }

    if (el.tagName === "BR") {
      if (el === startContainer) {
        result = out.length;
        return true;
      }
      out += "\n";
      return false;
    }

    if (el.tagName === "DIV" || el.tagName === "P") {
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
      if (startContainer === el) {
        const kids = Array.from(el.childNodes);
        for (let i = 0; i < startOffset && i < kids.length; i++) {
          if (walk(kids[i]!)) return true;
        }
        result = out.length;
        return true;
      }
      for (const child of Array.from(el.childNodes)) {
        if (walk(child)) return true;
      }
      if (!out.endsWith("\n")) out += "\n";
      return false;
    }

    if (startContainer === el) {
      const kids = Array.from(el.childNodes);
      for (let i = 0; i < startOffset && i < kids.length; i++) {
        if (walk(kids[i]!)) return true;
      }
      result = out.length;
      return true;
    }

    for (const child of Array.from(el.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) break;
  }

  return result;
}

/** 纯文本侧：光标前是否处于可弹出的 @ / ＠ 提及 */
export function getActiveShotMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, safeCaret);
  let at = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (AT_CHARS.has(before[i]!)) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  if (at > 0) {
    const prev = before[at - 1] ?? "";
    // 仅拦截邮箱类 ascii；中文/标点后的 @ 均可触发
    if (/[A-Za-z0-9._]/.test(prev)) return null;
  }
  const query = before.slice(at + 1);
  if (/[\s\n】]/.test(query)) return null;
  if (query.includes("【图:")) return null;
  return { start: at, query };
}

/** @deprecated 保留给旧测试；内部改走序列化检测 */
export function getContentEditableMention(
  root: HTMLElement,
): { query: string; atOffset: number; textNode: Text } | null {
  const text = serializeEditor(root);
  const caret = getSerializeCaretOffset(root);
  if (caret == null) return null;
  const active = getActiveShotMentionQuery(text, caret);
  if (!active) return null;
  // 无稳定 textNode 时返回占位，调用方应改用 getActiveShotMentionQuery
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  return {
    query: active.query,
    atOffset: active.start,
    textNode: node as Text,
  };
}

export function filterShotMentionAssets(
  assets: PickerAsset[],
  query: string,
  limit = 24,
): PickerAsset[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? assets.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.kind.toLowerCase().includes(q) ||
          KIND_LABEL[a.kind].includes(query.trim()),
      )
    : [...assets];
  const rank = { character: 0, scene: 1, prop: 2 } as const;
  return list
    .slice()
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** 图文一体提示词：可直接改字；键入 @ 挂载本镜头已添加素材为图片 */
export function ShotPromptEditor({
  value,
  disabled,
  readOnly = false,
  imageUrlById,
  mentionAssets,
  onChange,
}: Props) {
  const inert = Boolean(disabled || readOnly);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const lastSerializedRef = useRef(value);
  const mentionRef = useRef<MentionState | null>(null);
  const openRef = useRef(false);
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);

  const filtered = useMemo(
    () => (open ? filterShotMentionAssets(mentionAssets, query) : []),
    [open, mentionAssets, query],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focusedRef.current) return;
    const html = buildEditorHtml(value, imageUrlById);
    if (el.innerHTML !== html) {
      el.innerHTML = html || "<br>";
    }
    lastSerializedRef.current = value;
  }, [value, imageUrlById]);

  const refreshMention = useCallback(() => {
    const root = ref.current;
    if (!root || inert) {
      mentionRef.current = null;
      setOpen(false);
      return;
    }
    const text = serializeEditor(root);
    lastSerializedRef.current = text;
    let caret = getSerializeCaretOffset(root);
    // 空编辑器或光标落在元素上时，退化为文本末尾
    if (caret == null) caret = text.length;
    const active = getActiveShotMentionQuery(text, caret);
    if (!active) {
      mentionRef.current = null;
      setOpen(false);
      setQuery("");
      return;
    }
    mentionRef.current = {
      query: active.query,
      start: active.start,
      caret,
    };
    setOpen(true);
    setQuery(active.query);
    setActiveIndex(0);
  }, [inert]);

  const updateMenuPosition = useCallback(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const root = ref.current;
    const sel = window.getSelection();
    let top = 0;
    let left = 0;
    let ok = false;
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0) {
        top = rect.bottom + 6;
        left = rect.left;
        ok = true;
      }
    }
    if (!ok && root) {
      const rect = root.getBoundingClientRect();
      top = rect.top + 36;
      left = rect.left + 12;
      ok = true;
    }
    if (!ok) {
      setMenuPos(null);
      return;
    }
    const estimatedH = Math.min(240, 52 + Math.max(filtered.length, 1) * 44);
    if (top + estimatedH > window.innerHeight - 8) {
      top = Math.max(8, top - estimatedH - 24);
    }
    left = Math.min(Math.max(8, left), window.innerWidth - 240 - 8);
    setMenuPos({ top, left });
  }, [open, filtered.length]);

  useLayoutEffect(() => {
    updateMenuPosition();
  }, [updateMenuPosition, query, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const emitChange = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = serializeEditor(el);
    lastSerializedRef.current = next;
    onChange(next);
  }, [onChange]);

  const pickAsset = useCallback(
    (asset: PickerAsset) => {
      const root = ref.current;
      const mention = mentionRef.current;
      if (!root || !mention) return;

      // 点击菜单时选区可能已离开编辑器，必须以记录的 mention 范围为准
      const text = serializeEditor(root);
      let start = mention.start;
      let caret = mention.caret;
      const atStillValid =
        start >= 0 &&
        start < text.length &&
        AT_CHARS.has(text[start] ?? "") &&
        caret > start &&
        caret <= text.length;

      if (!atStillValid) {
        const liveCaret = getSerializeCaretOffset(root);
        const active =
          (liveCaret != null
            ? getActiveShotMentionQuery(text, liveCaret)
            : null) ?? getActiveShotMentionQuery(text, Math.min(caret, text.length));
        if (!active) return;
        start = active.start;
        caret =
          liveCaret != null && liveCaret > active.start
            ? liveCaret
            : active.start + 1 + active.query.length;
      }

      const token = `【图:${asset.id}:${asset.name}】`;
      const next = text.slice(0, start) + token + text.slice(caret);

      root.innerHTML = buildEditorHtml(next, imageUrlById) || "<br>";
      lastSerializedRef.current = next;
      onChange(next);

      mentionRef.current = null;
      setOpen(false);
      setQuery("");

      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        focusedRef.current = true;
        const chips = el.querySelectorAll(
          `[data-asset-id="${CSS.escape(asset.id)}"]`,
        );
        const chip = chips[chips.length - 1];
        if (chip) {
          let after = chip.nextSibling;
          if (!after || after.nodeType !== Node.TEXT_NODE) {
            after = document.createTextNode("\u200b");
            if (chip.nextSibling) {
              chip.parentNode?.insertBefore(after, chip.nextSibling);
            } else {
              chip.parentNode?.appendChild(after);
            }
          }
          const sel = window.getSelection();
          if (sel && after.nodeType === Node.TEXT_NODE) {
            const range = document.createRange();
            range.setStart(after, Math.min(1, after.textContent?.length ?? 0));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } else {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });
    },
    [imageUrlById, onChange],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
        pickAsset(filtered[activeIndex] ?? filtered[0]!);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pickAsset(filtered[activeIndex] ?? filtered[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
    }

    if (inert) return;
    const root = ref.current;
    if (!root) return;

    if (event.key === "Backspace") {
      const chip = findAssetChipBeforeCaret(root);
      if (chip) {
        event.preventDefault();
        removeAssetChip(chip);
        emitChange();
        setOpen(false);
        return;
      }
    }
    if (event.key === "Delete") {
      const chip = findAssetChipAfterCaret(root);
      if (chip) {
        event.preventDefault();
        removeAssetChip(chip);
        emitChange();
        setOpen(false);
      }
    }
  };

  const handleEditorClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const chip = target?.closest?.("[data-asset-id]") as HTMLElement | null;
    if (chip && ref.current?.contains(chip) && !inert) {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNode(chip);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setOpen(false);
      return;
    }
    refreshMention();
  };

  const menu =
    mounted && open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            className="sbw-prompt-mention-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            data-testid="shot-prompt-mention-menu"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="sbw-prompt-mention-menu__title">
              本镜头素材{mentionAssets.length === 0 ? "（暂无）" : ""}
            </div>
            <div className="sbw-prompt-mention-menu__list">
              {filtered.length === 0 ? (
                <div className="sbw-prompt-mention-menu__empty">
                  {mentionAssets.length === 0
                    ? "请先在镜头素材中添加人物/场景/道具"
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
                      className={`sbw-prompt-mention-menu__item${active ? " is-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => pickAsset(asset)}
                    >
                      <span className="sbw-prompt-mention-menu__thumb">
                        {asset.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.thumbUrl} alt="" />
                        ) : (
                          <span>
                            {asset.kind === "character"
                              ? "人"
                              : asset.kind === "scene"
                                ? "景"
                                : "道"}
                          </span>
                        )}
                      </span>
                      <span className="sbw-prompt-mention-menu__meta">
                        <span className="sbw-prompt-mention-menu__name">
                          {asset.name}
                        </span>
                        <span className="sbw-prompt-mention-menu__kind">
                          {KIND_LABEL[asset.kind]}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="sbw-prompt-editor-wrap">
      <div
        ref={ref}
        className={`sbw-prompt-editor${
          readOnly ? " is-readonly" : disabled ? " is-disabled" : ""
        }`}
        contentEditable={!inert}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="视频提示词"
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        data-testid="shot-prompt-editor"
        data-placeholder="填写本镜头视频提示词，键入 @ 挂载本镜头素材"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (menuRef.current?.contains(document.activeElement)) return;
            // 菜单打开时点击项会 preventDefault mousedown，不应重建 DOM
            if (openRef.current) return;
            focusedRef.current = false;
            const el = ref.current;
            if (!el) return;
            const next = serializeEditor(el);
            lastSerializedRef.current = next;
            if (next !== value) onChange(next);
            el.innerHTML = buildEditorHtml(next, imageUrlById) || "<br>";
            setOpen(false);
          }, 0);
        }}
        onInput={() => {
          emitChange();
          refreshMention();
        }}
        onKeyUp={() => refreshMention()}
        onClick={handleEditorClick}
        onKeyDown={handleKeyDown}
        onCompositionEnd={() => refreshMention()}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
      />
      {menu}
    </div>
  );
}
