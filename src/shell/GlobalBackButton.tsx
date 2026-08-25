"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { resolveBackTarget } from "@/shell/resolve-back-target";
import { confirmGenerationLeaveIfNeeded } from "@/shell/generation-busy";
import { confirmUnsavedLeaveIfNeeded } from "@/shell/unsaved-leave";
import { useChipBounce } from "@/shell/useChipBounce";

type Props = {
  showDivider?: boolean;
  href?: string;
};

export function GlobalBackButton({ showDivider = true, href }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const bounce = useChipBounce();
  const resolved = href ? { kind: "href" as const, href } : resolveBackTarget(pathname);

  if (resolved.kind === "hide") return null;

  const navigate = () => {
    // 始终 push 上一级 href，避免 history.back 落入中间 redirect 页。
    router.push(resolved.href);
  };

  const onClick = async () => {
    bounce.trigger();
    const genOk = await confirmGenerationLeaveIfNeeded(resolved.href);
    if (!genOk) return;
    const ok = await confirmUnsavedLeaveIfNeeded();
    if (ok) navigate();
  };

  return (
    <>
      <button
        type="button"
        className={`shell-back ${bounce.bounceClass}`}
        aria-label="返回"
        data-testid="shell-back-button"
        onClick={() => void onClick()}
        onAnimationEnd={bounce.onAnimationEnd}
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        <span className="shell-back__label">返回</span>
      </button>
      {showDivider ? <span className="shell-back-divider" aria-hidden /> : null}
    </>
  );
}
