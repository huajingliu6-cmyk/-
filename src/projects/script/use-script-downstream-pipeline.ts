"use client";

import { useEffect, useState } from "react";
import type { ScriptDownstreamPipelineStatus } from "@/projects/script/script-downstream-pipeline-types";

const EMPTY: ScriptDownstreamPipelineStatus = {
  phase: "not_started",
  canEnterStoryboard: false,
  message: "",
  episodesTotal: 0,
  episodesWithStoryboard: 0,
  episodesGenerating: 0,
  extractingAssets: false,
};

export function useScriptDownstreamPipeline(
  projectId: string,
  apiRoot = `/api/projects/${encodeURIComponent(projectId)}`,
): ScriptDownstreamPipelineStatus & { loading: boolean } {
  const [status, setStatus] = useState<ScriptDownstreamPipelineStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`${apiRoot}/script-downstream-pipeline`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as ScriptDownstreamPipelineStatus;
        if (cancelled) return;
        setStatus(payload);
        setLoading(false);
        if (!payload.canEnterStoryboard && payload.phase !== "not_started") {
          timer = setTimeout(() => {
            void poll();
          }, 4000);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiRoot, projectId]);

  return { ...status, loading };
}
