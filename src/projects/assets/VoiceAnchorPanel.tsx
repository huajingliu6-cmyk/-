"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  testId?: string;
  title?: string;
  /** Prefer opening above the anchor on desktop. */
  preferAbove?: boolean;
};

const MOBILE_MAX = 640;

export function VoiceAnchorPanel({
  open,
  onOpenChange,
  anchorRef,
  children,
  testId = "voice-anchor-panel",
  title,
  preferAbove = true,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [mobileSheet, setMobileSheet] = useState(false);

  const placePanel = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;

    const isMobile = window.innerWidth <= MOBILE_MAX;
    setMobileSheet(isMobile);

    if (isMobile) {
      setPanelStyle({});
      setPlaced(true);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(480, window.innerWidth - 24);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const panelH = Math.max(panel?.offsetHeight || 0, 320);
    let top = preferAbove ? rect.top - panelH - 8 : rect.bottom + 8;
    if (preferAbove && top < 12) {
      top = rect.bottom + 8;
    }
    if (top + panelH > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - panelH - 12);
    }
    setPanelStyle({
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
    });
    setPlaced(true);
  }, [anchorRef, preferAbove]);

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
      if (anchorRef.current?.contains(target)) return;
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
  }, [open, onOpenChange, placePanel, anchorRef]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`voice-anchor-panel${mobileSheet ? " voice-anchor-panel--sheet" : ""}${
        placed ? " is-placed" : ""
      }`}
      ref={panelRef}
      data-testid={testId}
      style={mobileSheet ? undefined : panelStyle}
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {title ? <div className="voice-anchor-panel__title">{title}</div> : null}
      {children}
    </div>,
    document.body,
  );
}
