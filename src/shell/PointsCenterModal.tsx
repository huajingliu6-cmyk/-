"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Coins, X } from "lucide-react";
import {
  formatCreditsBalance,
  type CreditsState,
} from "@/shell/useCredits";
import { prefersReducedMotion } from "@/shell/login-portal";
import "./points-center.css";

export type PointsTabId = "history" | "recharge" | "records";

type Props = {
  open: boolean;
  onClose: () => void;
  credits: CreditsState;
  /** 充值成功后刷新 Header / 弹窗余额；当前无充值流程时预留 */
  onCreditsRefresh: () => void;
  initialTab?: PointsTabId;
};

const TABS: Array<{ id: PointsTabId; label: string }> = [
  { id: "history", label: "积分历史" },
  { id: "recharge", label: "积分充值" },
  { id: "records", label: "充值记录" },
];

function balanceDisplay(credits: CreditsState): ReactNode {
  if (credits.status === "loading") {
    return (
      <span
        className="shell-credits__skeleton"
        style={{ width: "5rem", height: "1.75rem" }}
      />
    );
  }
  if (credits.status === "ready") {
    return formatCreditsBalance(credits.balance);
  }
  return "--";
}

/**
 * 积分中心：居中 Dialog（遮罩 / ESC / 点击外部关闭）。
 * 沿用账户设置 / ImageLightbox 的 dialog 模式，视觉对齐登录卡片深色玻璃语言。
 */
export function PointsCenterModal({
  open,
  onClose,
  credits,
  onCreditsRefresh,
  initialTab = "history",
}: Props) {
  const titleId = useId();
  const panelId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<PointsTabId>(initialTab);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setClosing(false);
      setActiveTab(initialTab);
    }
  }

  const finishClose = useCallback(() => {
    setClosing(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    setClosing(true);
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, 200);
  }, [closing, finishClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    onCreditsRefresh();
  }, [open, onCreditsRefresh]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 40);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [open, requestClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`pc-overlay${closing ? " is-closing" : ""}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className="pc-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pc-card__glow" aria-hidden />

        <div className="pc-header">
          <h2 id={titleId}>积分中心</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="pc-close"
            aria-label="关闭积分中心"
            onClick={requestClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="pc-balance">
          <div className="pc-balance__grid">
            <div>
              <div className="pc-balance__label">
                <Coins className="h-3.5 w-3.5 text-violet-300/80" aria-hidden />
                剩余积分
              </div>
              <div className="pc-balance__value" aria-live="polite">
                {balanceDisplay(credits)}
              </div>
            </div>
            <div>
              <div className="pc-balance__label">冻结积分</div>
              <div
                className="pc-balance__value pc-balance__value--frozen"
                aria-live="polite"
              >
                {credits.status === "ready"
                  ? formatCreditsBalance(credits.frozen)
                  : credits.status === "loading"
                    ? "…"
                    : "--"}
              </div>
            </div>
          </div>
          {credits.status === "ready" && credits.updatedAt ? (
            <div className="pc-balance__meta">
              最近更新{" "}
              {new Date(credits.updatedAt).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          ) : credits.status === "unavailable" ? (
            <div className="pc-balance__meta">积分余额接口尚未接入</div>
          ) : null}
        </div>

        <div className="pc-tabs" role="tablist" aria-label="积分中心分区">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${panelId}-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${panelId}-panel`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className="pc-tab"
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const idx = TABS.findIndex((t) => t.id === activeTab);
                const next =
                  e.key === "ArrowRight"
                    ? TABS[(idx + 1) % TABS.length]
                    : TABS[(idx - 1 + TABS.length) % TABS.length];
                if (next) setActiveTab(next.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          key={activeTab}
          id={`${panelId}-panel`}
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${activeTab}`}
          className="pc-panel"
        >
          {activeTab === "history" ? (
            <div className="pc-state">
              {/* TODO: 接入积分流水接口后渲染真实记录列表 */}
              <strong>暂无积分使用记录</strong>
              <p>
                积分历史接口尚未接入。接入后将显示使用类型、关联项目与积分变动。
              </p>
            </div>
          ) : null}

          {activeTab === "recharge" ? (
            <div className="pc-recharge-todo">
              {/*
                TODO: 嵌入现有充值档位 / 支付流程组件（当前工程无独立充值页或组件）。
                充值成功后调用 onCreditsRefresh()，并重新拉取积分历史与充值记录。
              */}
              <strong>积分充值暂未开放</strong>
              <p>
                充值入口已从顶栏移入此处。待接入既有充值档位、价格与支付流程后，可在此完成充值；成功后将刷新剩余积分、积分历史与充值记录。
              </p>
            </div>
          ) : null}

          {activeTab === "records" ? (
            <div className="pc-state">
              {/* TODO: 接入充值订单接口后渲染真实订单列表（含复制订单号） */}
              <strong>暂无充值记录</strong>
              <p>
                充值记录接口尚未接入。接入后将显示订单号、金额、获得积分与订单状态。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
