import "server-only";

import {
  PRODUCTION_REVISION_CONFLICT,
  loadWorkspaceUnrecovered,
  saveWorkspaceDocumentCas,
} from "@/projects/storyboard/production-store";
import { withProjectStoryboardLock } from "@/projects/storyboard/production-lock";
import { carryStoryboardRemoteRevision } from "@/projects/storyboard/remote-production-store";
import { invalidateAfterScriptChange } from "@/projects/storyboard/services/invalidate";

export async function invalidateProductionsAfterScriptSave(
  projectId: string,
): Promise<void> {
  await withProjectStoryboardLock(projectId, async () => {
    const latest = await loadWorkspaceUnrecovered(projectId);
    if (!latest) return;
    if (latest.productions.length === 0) return;

    const { loadScriptDraft } = await import(
      "@/projects/script/script-draft-store"
    );
    const { refreshProductionPrompts } = await import(
      "@/projects/script/script-prompt-refresh"
    );
    const script = await loadScriptDraft(projectId).catch(() => null);
    const scriptRevision = script?.documentRevision ?? 0;
    const next = {
      ...latest,
      productions: latest.productions.map((production) => {
        const invalidated = invalidateAfterScriptChange(production);
        const episode = script?.episodes.find(
          (item) => item.id === production.episodeId,
        );
        const scriptText =
          episode?.content ||
          invalidated.confirmedScriptText ||
          invalidated.workingScriptText ||
          "";
        return refreshProductionPrompts({
          production: invalidated,
          scriptText,
          scriptRevision,
        });
      }),
      updatedAt: new Date().toISOString(),
    };
    carryStoryboardRemoteRevision(latest, next);
    try {
      await saveWorkspaceDocumentCas(next);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === PRODUCTION_REVISION_CONFLICT
      ) {
        throw error;
      }
      throw error;
    }
  });
}
