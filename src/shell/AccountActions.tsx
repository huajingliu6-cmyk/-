"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Coins } from "lucide-react";
import { AuthUserMenu } from "@/auth/AuthUserMenu";
import type { AuthUser } from "@/auth/types";
import { PointsCenterModal, type PointsTabId } from "@/shell/PointsCenterModal";
import {
  OPEN_POINTS_CENTER_EVENT,
  type OpenPointsCenterDetail,
} from "@/shell/open-points-center";
import { useChipBounce } from "@/shell/useChipBounce";
import {
  formatCreditsBalance,
  useCredits,
  type CreditsState,
} from "@/shell/useCredits";

type Props = {
  user: AuthUser;
};

function toCreditsState(credits: ReturnType<typeof useCredits>): CreditsState {
  if (credits.status === "ready") {
    return {
      status: "ready",
      balance: credits.balance,
      frozen: credits.frozen,
      updatedAt: credits.updatedAt,
    };
  }
  return { status: credits.status };
}

export function AccountActions({ user }: Props) {
  const credits = useCredits();
  const creditsState = toCreditsState(credits);
  const creditsBounce = useChipBounce();
  const profileBounce = useChipBounce();
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsTab, setPointsTab] = useState<PointsTabId>("history");

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenPointsCenterDetail>).detail;
      setPointsTab(detail?.tab ?? "recharge");
      setPointsOpen(true);
    };
    window.addEventListener(OPEN_POINTS_CENTER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_POINTS_CENTER_EVENT, onOpen);
  }, []);

  const displayName = user.displayName || user.username;
  const initial = (displayName || "?").slice(0, 1).toUpperCase();

  const creditsLabel =
    creditsState.status === "unavailable" ? "积分暂不可用" : "剩余积分";

  return (
    <div className="shell-account">
      <button
        type="button"
        className={`shell-chip shell-chip--glass shell-credits shell-credits--btn hidden sm:inline-flex ${creditsBounce.bounceClass}`}
        title={creditsLabel}
        aria-haspopup="dialog"
        aria-expanded={pointsOpen}
        onClick={() => {
          creditsBounce.trigger();
          setPointsTab("history");
          setPointsOpen(true);
        }}
        onAnimationEnd={creditsBounce.onAnimationEnd}
      >
        <Coins className="h-3.5 w-3.5 shrink-0 text-violet-300/90" aria-hidden />
        {creditsState.status === "loading" ? (
          <>
            <span className="shell-credits__label">剩余积分：</span>
            <span className="shell-credits__skeleton" aria-hidden />
            <span className="sr-only">加载中</span>
          </>
        ) : creditsState.status === "ready" ? (
          <>
            <span className="shell-credits__label">剩余积分：</span>
            <span className="shell-credits__value">
              {formatCreditsBalance(creditsState.balance)}
            </span>
            <span className="shell-credits__sep" aria-hidden>
              ·
            </span>
            <span className="shell-credits__label">冻结：</span>
            <span className="shell-credits__value shell-credits__value--frozen">
              {formatCreditsBalance(creditsState.frozen)}
            </span>
          </>
        ) : (
          <>
            <span className="shell-credits__label">剩余积分：</span>
            <span className="shell-credits__value shell-credits__value--muted">
              --
            </span>
          </>
        )}
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-white/40"
          aria-hidden
        />
      </button>

      <div
        className={`shell-avatar ${profileBounce.bounceClass}`}
        onAnimationEnd={profileBounce.onAnimationEnd}
      >
        <span className="shell-avatar__mark" aria-hidden>
          {initial}
        </span>
        <div
          className="min-w-0"
          onPointerDown={() => profileBounce.trigger()}
        >
          <AuthUserMenu user={user} />
        </div>
      </div>

      <PointsCenterModal
        open={pointsOpen}
        onClose={() => setPointsOpen(false)}
        credits={creditsState}
        onCreditsRefresh={credits.refresh}
        initialTab={pointsTab}
      />
    </div>
  );
}
