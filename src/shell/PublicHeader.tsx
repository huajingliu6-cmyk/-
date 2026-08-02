"use client";

import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/workflow/components/BrandMark";
import { HeaderLoginPanel } from "@/home/components/HeaderLoginPanel";
import { scrollToCreationFlow } from "@/home/lib/scroll-to-creation-flow";
import { useChipBounce } from "@/shell/useChipBounce";
import type { AuthUser } from "@/auth/types";

type Props = {
  onLoggedIn: (user: AuthUser) => void;
};

export function PublicHeader({ onLoggedIn }: Props) {
  const guideBounce = useChipBounce();

  return (
    <header className="shell-header">
      <div className="shell-header__inner">
        <Link href="/" className="shell-brand" aria-label="回到首页">
          <BrandMark size={28} className="opacity-100" />
          <span className="shell-brand__name">智能视频工作台</span>
        </Link>

        <div className="shell-account shell-account--end">
          <button
            type="button"
            className={`shell-chip shell-chip--guide ${guideBounce.bounceClass}`}
            onClick={() => {
              guideBounce.trigger();
              scrollToCreationFlow();
            }}
            onAnimationEnd={guideBounce.onAnimationEnd}
          >
            查看创作流程
          </button>

          <Suspense
            fallback={
              <span className="shell-chip shell-chip--login opacity-60">
                登录
              </span>
            }
          >
            <HeaderLoginPanel onLoggedIn={onLoggedIn} showTrigger />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
