import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { invalidateAfterScriptChange } from "@/projects/storyboard/services/invalidate";

/**
 * Mark all episode productions stale after script draft content changes.
 * Preserves history rows and does not create GenerationRecords.
 */
export async function invalidateWorkspaceAfterScriptDraftChange(
  projectId: string,
): Promise<void> {
  const workspace = await loadWorkspace(projectId);
  if (!workspace || workspace.productions.length === 0) return;

  const productions = workspace.productions.map((production) =>
    invalidateAfterScriptChange(production),
  );
  await saveWorkspace({
    ...workspace,
    productions,
    updatedAt: new Date().toISOString(),
  });
}
