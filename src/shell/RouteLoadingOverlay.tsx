"use client";

import { Sparkles } from "lucide-react";
import "@/shell/route-loading-overlay.css";

type Props = {
  title: string;
  description?: string;
};

export function RouteLoadingOverlay({ title, description }: Props) {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <div className="route-loading__backdrop" aria-hidden />
      <div className="route-loading__card">
        <div className="route-loading__icon" aria-hidden>
          <Sparkles />
          <span className="route-loading__orbit" />
        </div>
        <div className="route-loading__copy">
          <strong>{title}</strong>
          <span>{description ?? "正在准备页面内容，请稍候…"}</span>
        </div>
        <div className="route-loading__progress" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  );
}