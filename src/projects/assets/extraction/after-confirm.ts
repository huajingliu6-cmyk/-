import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import {
  getActiveVersion,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";
export type AfterScriptConfirmAction =
  | { action: "auto-start"; task: AssetExtractionTask; reused: boolean }
  | { action: "noop" }
  | { action: "auto-reextract"; task: AssetExtractionTask; reused: boolean };

/**
 * 剧本确认后检查资产提取状态；不再自动启动提取（由用户在资产页手动触发）。
 */
export async function afterScriptSplitConfirmed(input: {
  projectId: string;
  sourceFingerprint: string;
}): Promise<AfterScriptConfirmAction> {
  await ensureAssetExtractionMigrated(input.projectId);
  const store = await loadAssetExtractionStore(input.projectId);
  const active = getActiveVersion(store);
  if (!active) {
    return { action: "noop" };
  }
  if (active.sourceFingerprint === input.sourceFingerprint) {
    return { action: "noop" };
  }
  return { action: "noop" };
}
