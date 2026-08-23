import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import {
  getActiveVersion,
  lastSuccessfulModelKey,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import { startAssetExtractionTask } from "@/projects/assets/extraction/start-task";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";

export type AfterScriptConfirmAction =
  | { action: "prompt" }
  | { action: "noop" }
  | { action: "auto-reextract"; task: AssetExtractionTask; reused: boolean };

export async function afterScriptSplitConfirmed(input: {
  projectId: string;
  sourceFingerprint: string;
}): Promise<AfterScriptConfirmAction> {
  await ensureAssetExtractionMigrated(input.projectId);
  const store = await loadAssetExtractionStore(input.projectId);
  const active = getActiveVersion(store);
  if (!active) {
    return { action: "prompt" };
  }
  if (active.sourceFingerprint === input.sourceFingerprint) {
    return { action: "noop" };
  }
  const started = await startAssetExtractionTask({
    projectId: input.projectId,
    sourceFingerprint: input.sourceFingerprint,
    scope: "all",
    modelKey: lastSuccessfulModelKey(store),
  });
  return {
    action: "auto-reextract",
    task: started.task,
    reused: started.reused,
  };
}
