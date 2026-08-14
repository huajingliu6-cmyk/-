"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Pencil, Settings2, Trash2 } from "lucide-react";

export type WorkbenchProjectContextAction =
  | "open"
  | "rename"
  | "delete"
  | "rules";

type MenuState = {
  projectId: string;
  projectName: string;
  canManage: boolean;
  canEditRules: boolean;
  x: number;
  y: number;
};

type Props = {
  menu: MenuState | null;
  onClose: () => void;
  onAction: (
    action: WorkbenchProjectContextAction,
    projectId: string,
  ) => void;
};

const MENU_WIDTH = 200;
const MENU_EST_HEIGHT = 220;

export function WorkbenchProjectContextMenu({
  menu,
  onClose,
  onAction,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(menu.x, vw - MENU_WIDTH - 8);
    const top = Math.min(menu.y, vh - MENU_EST_HEIGHT - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && ref.current?.contains(node)) return;
      onClose();
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

  const items: Array<{
    id: WorkbenchProjectContextAction;
    label: string;
    icon: typeof FolderOpen;
    danger?: boolean;
    hidden?: boolean;
  }> = [
    { id: "open", label: "打开项目", icon: FolderOpen },
    {
      id: "rename",
      label: "重命名",
      icon: Pencil,
      hidden: !menu.canManage,
    },
    {
      id: "rules",
      label: "编辑项目规则",
      icon: Settings2,
      hidden: !menu.canEditRules,
    },
    {
      id: "delete",
      label: "删除项目",
      icon: Trash2,
      danger: true,
      hidden: !menu.canManage,
    },
  ];

  return createPortal(
    <div
      ref={ref}
      className="wb-context-menu"
      role="menu"
      aria-label={`${menu.projectName} 操作`}
      data-testid="project-card-context-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="wb-context-menu__title">{menu.projectName}</div>
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`wb-context-menu__item${item.danger ? " is-danger" : ""}`}
            data-testid={`project-card-ctx-${item.id}`}
            onClick={() => {
              onAction(item.id, menu.projectId);
              onClose();
            }}
          >
            <item.icon className="h-3.5 w-3.5" aria-hidden />
            <span>{item.label}</span>
          </button>
        ))}
    </div>,
    document.body,
  );
}

export type { MenuState as WorkbenchProjectContextMenuState };
