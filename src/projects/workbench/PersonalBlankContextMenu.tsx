"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";

export type PersonalBlankContextMenuState = {
  x: number;
  y: number;
};

type Props = {
  menu: PersonalBlankContextMenuState | null;
  canCreate: boolean;
  onClose: () => void;
  onCreate: () => void;
};

const MENU_WIDTH = 200;
const MENU_HEIGHT = 52;

export function PersonalBlankContextMenu({
  menu,
  canCreate,
  onClose,
  onCreate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !ref.current?.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, onClose]);

  if (!menu || typeof document === "undefined") return null;
  const pos = {
    left: Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8)),
  };

  return createPortal(
    <div
      ref={ref}
      className="wb-context-menu"
      role="menu"
      aria-label="空白处菜单"
      data-testid="personal-blank-context-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        type="button"
        role="menuitem"
        className="wb-context-menu__item"
        disabled={!canCreate}
        data-testid="personal-blank-ctx-create"
        onClick={() => {
          if (!canCreate) return;
          onCreate();
          onClose();
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span>新建项目</span>
      </button>
    </div>,
    document.body,
  );
}
