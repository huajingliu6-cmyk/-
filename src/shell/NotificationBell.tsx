"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import type { AppNotification } from "@/notifications/types";
import {
  refreshNotifications,
  subscribeNotifications,
} from "@/shell/notifications-poller";

export function NotificationBell() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    return subscribeNotifications((snapshot) => {
      setNotifications(snapshot.notifications);
      setUnreadCount(snapshot.unreadCount);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleClick = async (note: AppNotification) => {
    // Owner submit notices stay unread (and keep the badge) while items remain
    // pending; they are marked read only when the submission is fully decided.
    const keepUnreadWhilePending = note.type === "asset_approval_submitted";
    if (!note.readAt && !keepUnreadWhilePending) {
      await fetch(
        `/api/notifications/${encodeURIComponent(note.id)}/read`,
        { method: "POST" },
      );
      await refreshNotifications();
    }
    setOpen(false);
    if (note.type === "asset_approval_submitted") {
      router.push(
        `/app/projects/${encodeURIComponent(note.projectId)}/assets/design?approvalSubmissionId=${encodeURIComponent(note.submissionId)}&episodeId=${encodeURIComponent(note.episodeId)}`,
      );
      return;
    }
    if (
      note.type === "asset_approval_approved" ||
      note.type === "asset_approval_rejected"
    ) {
      router.push(
        `/app/workspace/projects/${encodeURIComponent(note.projectId)}/assets/design?episodeId=${encodeURIComponent(note.episodeId)}`,
      );
    }
  };

  const handleDelete = async (note: AppNotification, event: MouseEvent) => {
    event.stopPropagation();
    if (!note.readAt) return;
    const res = await fetch(
      `/api/notifications/${encodeURIComponent(note.id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) return;
    await refreshNotifications();
  };

  return (
    <div
      ref={rootRef}
      className="shell-notification"
      data-testid="notification-bell-wrap"
    >
      <button
        type="button"
        className="shell-notification__btn"
        aria-label="通知"
        data-testid="notification-bell"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            // 仅打开时刷新；关闭不打网
            if (next) void refreshNotifications();
            return next;
          });
        }}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span
            className="shell-notification__badge"
            data-testid="notification-unread-badge"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="shell-notification__panel"
          data-testid="notification-panel"
        >
          <div className="shell-notification__panel-head">通知</div>
          {notifications.length === 0 ? (
            <p className="shell-notification__empty">暂无通知</p>
          ) : (
            <ul className="shell-notification__list">
              {notifications.map((note) => (
                <li key={note.id} className="shell-notification__row">
                  <button
                    type="button"
                    className={`shell-notification__item${
                      note.readAt ? "" : " is-unread"
                    }`}
                    onClick={() => void handleClick(note)}
                    data-testid={`notification-item-${note.id}`}
                  >
                    <strong>{note.title}</strong>
                    <span>{note.summary}</span>
                    <span className="shell-notification__time">
                      {new Date(note.createdAt).toLocaleString()}
                    </span>
                  </button>
                  {note.readAt ? (
                    <button
                      type="button"
                      className="shell-notification__delete"
                      title="删除已完成通知"
                      aria-label="删除通知"
                      data-testid={`notification-delete-${note.id}`}
                      onClick={(e) => void handleDelete(note, e)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
