"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type StatusPayload = {
  needed?: boolean;
  configured?: boolean;
  message?: string | null;
  relativeHint?: string;
};

export function MockSetupBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState("data/mock/mock-video.mp4");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mock-video/status");
        if (!res.ok) return;
        const payload = (await res.json()) as StatusPayload;
        if (cancelled) return;
        if (payload.needed && payload.configured === false) {
          setMessage(
            payload.message ??
              "尚未配置本地 Mock 视频，Mock 生成将失败。",
          );
          if (payload.relativeHint) setHint(payload.relativeHint);
          setVisible(true);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-[55] flex w-[min(92vw,36rem)] -translate-x-1/2 items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/95 px-3 py-2 text-xs text-amber-50 shadow-lg">
      <div className="min-w-0 flex-1 leading-relaxed">
        <div className="font-medium text-amber-100">Mock 视频未配置</div>
        <div className="mt-0.5 text-amber-100/85">{message}</div>
        <div className="mt-1 font-mono text-[10px] text-amber-200/70">
          {hint}
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-amber-200/70 hover:bg-amber-500/20 hover:text-amber-50"
        title="本次会话不再提示"
        onClick={() => setVisible(false)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
