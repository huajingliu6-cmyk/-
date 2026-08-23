/**
 * 全局「生成进行中」登记：任意生成任务在途时，拦截离开/切页，避免中断进度。
 * 资产提取任务带 projectId：允许进入首页和其他项目，但拦截当前项目内跳转。
 */

import type { AssetExtractionProgress } from "@/projects/assets/extraction/types";

export type GenerationBusyKind = "generic" | "asset-extraction";

export type AssetExtractionBusyOverlay = {
  stage: string;
  stageLabel: string;
  estimatedProgress: number;
  errorMessage?: string | null;
  progress?: AssetExtractionProgress | null;
};

export type GenerationBusyEntry = {
  id: string;
  label: string;
  projectId?: string | null;
  kind?: GenerationBusyKind;
  overlay?: AssetExtractionBusyOverlay | null;
  leaveMessage?: string;
};

export type BeginGenerationBusyOptions = {
  projectId?: string | null;
  kind?: GenerationBusyKind;
  overlay?: AssetExtractionBusyOverlay | null;
  leaveMessage?: string;
};

const entries = new Map<string, GenerationBusyEntry>();
const listeners = new Set<() => void>();

type BlockUi = {
  showBlocked: (message?: string) => Promise<false>;
};

let blockUi: BlockUi | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeGenerationBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginGenerationBusy(
  id: string,
  label: string,
  options?: BeginGenerationBusyOptions,
): () => void {
  const key = id.trim();
  if (!key) {
    return () => undefined;
  }
  entries.set(key, {
    id: key,
    label: label.trim() || "生成任务",
    projectId: options?.projectId ?? null,
    kind: options?.kind ?? "generic",
    overlay: options?.overlay ?? null,
    leaveMessage: options?.leaveMessage,
  });
  emit();
  return () => {
    if (entries.delete(key)) emit();
  };
}

export function updateGenerationBusy(
  id: string,
  patch: Partial<Omit<GenerationBusyEntry, "id">>,
): void {
  const current = entries.get(id);
  if (!current) return;
  entries.set(id, { ...current, ...patch });
  emit();
}

export function isGenerationBusy(): boolean {
  return entries.size > 0;
}

export function listGenerationBusyEntries(): GenerationBusyEntry[] {
  return [...entries.values()];
}

export function listGenerationBusyLabels(): string[] {
  return listGenerationBusyEntries().map((entry) => entry.label);
}

export function getGenerationBusySummary(): string {
  const labels = listGenerationBusyLabels();
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]} 等 ${labels.length} 项`;
}

export function getAssetExtractionBusyOverlay(): AssetExtractionBusyOverlay | null {
  const entry = listGenerationBusyEntries().find(
    (item) => item.kind === "asset-extraction" && item.overlay,
  );
  return entry?.overlay ?? null;
}

export function isHrefInsideProject(href: string, projectId: string): boolean {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  const prefixes = [
    `/app/projects/${encodeURIComponent(projectId)}`,
    `/app/projects/${projectId}`,
    `/app/workspace/projects/${encodeURIComponent(projectId)}`,
    `/app/workspace/projects/${projectId}`,
  ];
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function shouldBlockGenerationLeave(targetHref?: string): boolean {
  if (entries.size === 0) return false;
  if (!targetHref) {
    return [...entries.values()].some((entry) => entry.kind !== "asset-extraction")
      ? true
      : true;
  }
  for (const entry of entries.values()) {
    if (entry.kind === "asset-extraction" && entry.projectId) {
      if (isHrefInsideProject(targetHref, entry.projectId)) return true;
      continue;
    }
    return true;
  }
  return false;
}

export function bindGenerationBusyUi(next: BlockUi | null): void {
  blockUi = next;
}

export async function confirmGenerationLeaveIfNeeded(
  targetHref?: string,
): Promise<boolean> {
  if (!shouldBlockGenerationLeave(targetHref)) return true;
  const extraction = listGenerationBusyEntries().find(
    (entry) => entry.kind === "asset-extraction",
  );
  const message =
    extraction?.leaveMessage ||
    (getGenerationBusySummary()
      ? `当前正在进行「${getGenerationBusySummary()}」。请等待完成后再进行其他操作。`
      : undefined);
  if (blockUi) {
    await blockUi.showBlocked(message);
    return false;
  }
  return false;
}

export function clearGenerationBusyForTests(): void {
  if (entries.size === 0) return;
  entries.clear();
  emit();
}
