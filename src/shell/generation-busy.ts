/**
 * 全局「生成进行中」登记：任意生成任务在途时，拦截离开/切页，避免中断进度。
 * 与 unsaved-leave 类似，供壳层返回键、主导航、阶段导航统一查询。
 */

export type GenerationBusyEntry = {
  id: string;
  label: string;
};

const entries = new Map<string, GenerationBusyEntry>();
const listeners = new Set<() => void>();

type BlockUi = {
  showBlocked: () => Promise<false>;
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

export function beginGenerationBusy(id: string, label: string): () => void {
  const key = id.trim();
  if (!key) {
    return () => undefined;
  }
  entries.set(key, { id: key, label: label.trim() || "生成任务" });
  emit();
  return () => {
    if (entries.delete(key)) emit();
  };
}

export function isGenerationBusy(): boolean {
  return entries.size > 0;
}

export function listGenerationBusyLabels(): string[] {
  return [...entries.values()].map((entry) => entry.label);
}

export function getGenerationBusySummary(): string {
  const labels = listGenerationBusyLabels();
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]} 等 ${labels.length} 项`;
}

/** 由 GenerationBusyGuard 挂载时绑定弹层 */
export function bindGenerationBusyUi(next: BlockUi | null): void {
  blockUi = next;
}

/**
 * 若有生成在途：弹出拦截提示并返回 false（不允许离开）。
 * 无生成时返回 true。
 */
export async function confirmGenerationLeaveIfNeeded(): Promise<boolean> {
  if (!isGenerationBusy()) return true;
  if (blockUi) {
    await blockUi.showBlocked();
    return false;
  }
  return false;
}

/** 仅测试用：清空登记，避免用例间串扰 */
export function clearGenerationBusyForTests(): void {
  if (entries.size === 0) return;
  entries.clear();
  emit();
}
