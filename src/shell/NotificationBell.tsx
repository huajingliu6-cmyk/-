"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import type { AppNotification } from "@/notifications/types";
import { prefersReducedMotion } from "@/shell/login-portal";
import {
  refreshNotifications,
  subscribeNotifications,
} from "@/shell/notifications-poller";
import { useChipBounce } from "@/shell/useChipBounce";
import { writeActiveSpace } from "@/enterprise/client-space";

const PANEL_CLOSE_MS = 220;
const ROW_EXIT_MS = 380;

export function NotificationBell() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const bounce = useChipBounce();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    return subscribeNotifications((snapshot) => {
      setNotifications(snapshot.notifications);
      setUnreadCount(snapshot.unreadCount);
    });
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const finishClose = useCallback(() => {
    setClosing(false);
    setOpen(false);
  }, []);

  const requestClose = useCallback(() => {
    if (!open) return;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    if (closing) return;
    setClosing(true);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, PANEL_CLOSE_MS);
  }, [clearCloseTimer, closing, finishClose, open]);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    setClosing(false);
    setOpen(true);
    void refreshNotifications();
  }, [clearCloseTimer]);

  const togglePanel = useCallback(() => {
    bounce.trigger();
    if (open && !closing) {
      requestClose();
      return;
    }
    if (!open) openPanel();
  }, [bounce, closing, open, openPanel, requestClose]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!open || closing) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      requestClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closing, open, requestClose]);

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
    requestClose();
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
      return;
    }
    if (
      (note.type === "enterprise_join_approved" ||
        note.type === "enterprise_join_rejected") &&
      note.enterpriseId
    ) {
      if (note.type === "enterprise_join_approved") {
        writeActiveSpace({ kind: "enterprise", enterpriseId: note.enterpriseId });
        router.push("/app/team");
        return;
      }
      writeActiveSpace({ kind: "personal" });
      router.push("/app/projects");
    }
  };

  const removeLocally = useCallback((noteId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== noteId));
    setExitingIds((prev) => {
      if (!prev.has(noteId)) return prev;
      const next = new Set(prev);
      next.delete(noteId);
      return next;
    });
  }, []);

  const handleDelete = (note: AppNotification, event: MouseEvent) => {
    event.stopPropagation();
    if (!note.readAt) return;
    if (exitingIds.has(note.id)) return;

    const deleteRequest = fetch(
      `/api/notifications/${encodeURIComponent(note.id)}`,
      { method: "DELETE" },
    ).then(async (res) => {
      if (!res.ok) throw new Error("delete failed");
      await refreshNotifications();
    });

    if (prefersReducedMotion()) {
      void deleteRequest.catch(() => {
        void refreshNotifications();
      });
      removeLocally(note.id);
      return;
    }

    setExitingIds((prev) => new Set(prev).add(note.id));
    window.setTimeout(() => {
      removeLocally(note.id);
    }, ROW_EXIT_MS);

    void deleteRequest.catch(() => {
      // Roll back optimistic hide if the server reject.
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
      void refreshNotifications();
    });
  };

  const onRowAnimationEnd = (
    noteId: string,
    event: AnimationEvent<HTMLLIElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (!exitingIds.has(noteId)) return;
    removeLocally(noteId);
  };

  const panelVisible = open || closing;

  return (
    <div
      ref={rootRef}
      className="shell-notification"
      data-testid="notification-bell-wrap"
    >
      <button
        type="button"
        className={`shell-notification__btn ${bounce.bounceClass}`}
        aria-label="通知"
        aria-expanded={open && !closing}
        data-testid="notification-bell"
        onClick={togglePanel}
        onAnimationEnd={bounce.onAnimationEnd}
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
      {panelVisible ? (
        <div
          className={`shell-notification__panel${closing ? " is-closing" : ""}`}
          data-testid="notification-panel"
        >
          <div className="shell-notification__panel-head">通知</div>
          {notifications.length === 0 ? (
            <p className="shell-notification__empty">暂无通知</p>
          ) : (
            <ul className="shell-notification__list">
              {notifications.map((note) => {
                const exiting = exitingIds.has(note.id);
                return (
                  <li
                    key={note.id}
                    className={`shell-notification__row${
                      exiting ? " is-exiting" : ""
                    }`}
                    onAnimationEnd={(event) =>
                      onRowAnimationEnd(note.id, event)
                    }
                  >
                    <button
                      type="button"
                      className={`shell-notification__item${
                        note.readAt ? "" : " is-unread"
                      }`}
                      onClick={() => void handleClick(note)}
                      data-testid={`notification-item-${note.id}`}
                      disabled={exiting}
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
                        className={`shell-notification__delete${
                          exiting ? " is-pop" : ""
                        }`}
                        title="删除已完成通知"
                        aria-label="删除通知"
                        data-testid={`notification-delete-${note.id}`}
                        disabled={exiting}
                        onClick={(e) => handleDelete(note, e)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
