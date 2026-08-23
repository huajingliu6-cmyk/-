/**
 * Browser-safe auto-split UI helpers (no Node/fs).
 */

export function formatScriptAutoSplitNote(input: {
  episodeCount: number;
  mode?: string;
  warnings?: string[];
  idempotent?: boolean;
  downstreamSync?: string | null;
  error?: string | null;
}): string {
  if (input.error) {
    return input.error;
  }
  const modeHint =
    input.mode === "blocks"
      ? "（按段落均分）"
      : input.mode === "title"
        ? "（按标题）"
        : "";
  const warn =
    input.warnings && input.warnings.length > 0
      ? `（${input.warnings.slice(0, 2).join("；")}）`
      : "";
  const base = input.idempotent
    ? `剧本未变化，已保留现有 ${input.episodeCount} 集。`
    : `已自动分集${modeHint}，共 ${input.episodeCount} 集。${warn}`;
  if (input.downstreamSync === "pending") {
    return `${base}工作台同步进行中，尚未完成。`;
  }
  if (input.downstreamSync === "failed") {
    return `${base}工作台同步失败，请从同步状态重试。`;
  }
  if (input.downstreamSync === "unknown") {
    return `${base}工作台同步结果未知，请查看同步状态。`;
  }
  return base;
}

export function scriptShowsFormalEpisodeList(input: {
  splitStatus: string;
  formalEpisodeCount: number;
}): boolean {
  if (
    input.splitStatus === "failed" ||
    input.splitStatus === "stale" ||
    input.splitStatus === "review"
  ) {
    return false;
  }
  return input.formalEpisodeCount > 0;
}
