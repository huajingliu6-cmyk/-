"use client";

import { useEffect, useState } from "react";

export type AssetGenerationStage =
  | "validating"
  | "submitted"
  | "generating"
  | "saving"
  | "completed"
  | "failed";

export type AssetGenerationProgress = {
  stage: AssetGenerationStage;
  percent: number;
  message?: string;
};

const GENERATING_CAP = 82;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

type Props = {
  progress: AssetGenerationProgress;
};

export function DesignGenerationOverlay({ progress }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [displayPercent, setDisplayPercent] = useState(() =>
    clampPercent(progress.percent),
  );

  useEffect(() => {
    if (progress.stage === "failed") {
      setDisplayPercent(clampPercent(progress.percent));
      return;
    }

    if (progress.stage === "completed") {
      setDisplayPercent(100);
      return;
    }

    if (progress.stage !== "generating") {
      setDisplayPercent(clampPercent(progress.percent));
      return;
    }

    const floor = Math.min(
      GENERATING_CAP,
      clampPercent(progress.percent),
    );

    setDisplayPercent((previous) =>
      Math.min(GENERATING_CAP, Math.max(previous, floor)),
    );

    if (reducedMotion) return;

    const timer = window.setInterval(() => {
      setDisplayPercent((previous) => {
        if (previous >= GENERATING_CAP) return GENERATING_CAP;

        const step =
          previous < 55 ? 1.2 : previous < 70 ? 0.7 : 0.35;

        return Math.min(GENERATING_CAP, previous + step);
      });
    }, 420);

    return () => window.clearInterval(timer);
  }, [progress.percent, progress.stage, reducedMotion]);

  const percent = clampPercent(displayPercent);

  return (
    <div
      className={[
        "ead-generation-overlay",
        progress.stage === "failed" ? "is-failed" : "",
        progress.stage === "completed" ? "is-completed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-label={`图片生成进度 ${percent}%`}
      data-testid="ead-generation-overlay"
    >
      <div className="ead-generation-overlay__readout">
        <span className="ead-generation-overlay__number">{percent}</span>
        <span className="ead-generation-overlay__unit">%</span>
      </div>
    </div>
  );
}
