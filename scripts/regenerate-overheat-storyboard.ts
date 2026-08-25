/**
 * One-off: unlock + regenerate storyboard prompts for project「过热」.
 * Usage (inside web container): npx tsx scripts/regenerate-overheat-storyboard.ts
 */
import { randomUUID } from "crypto";
import { updateWorkspaceUnderLock } from "@/projects/storyboard/production-store";
import { generateStoryboardEpisode } from "@/projects/storyboard/services/generate-storyboard-episode";

const PROJECT_ID = "p_ee05f58a426f";
const EPISODE_ID = "ep_4f932ee976f348768c240aff6088be06";
const USER_ID = "d1154eef-ddc4-4dc8-b2d8-0d7fd1765f6c";

async function main() {
  console.info("[regen] unlocking promptLocked shots for 过热 …");
  await updateWorkspaceUnderLock(PROJECT_ID, async (workspace) => {
    let changed = false;
    const productions = workspace.productions.map((production) => {
      if (production.episodeId !== EPISODE_ID) return production;
      const board = production.activeStoryboard;
      if (!board) return production;
      const scenes = board.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => {
          if (!shot.promptLocked && !shot.locked) return shot;
          changed = true;
          return {
            ...shot,
            promptLocked: false,
            locked: false,
            storyboardPromptRuleVersion: null,
          };
        }),
      }));
      if (!changed) return production;
      return {
        ...production,
        status: "storyboard_incomplete" as const,
        generationError: null,
        activeStoryboard: {
          ...board,
          scenes,
        },
      };
    });
    if (!changed) {
      console.info("[regen] shots already unlocked");
      return null;
    }
    return { ...workspace, productions };
  });

  console.info("[regen] calling generateStoryboardEpisode …");
  const result = await generateStoryboardEpisode({
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    userId: USER_ID,
    idempotencyKey: randomUUID(),
  });

  const production = result.production;
  const shotCount =
    production.activeStoryboard?.scenes.reduce(
      (n, scene) => n + scene.shots.length,
      0,
    ) ?? 0;
  const lockedCount =
    production.activeStoryboard?.scenes.flatMap((s) => s.shots).filter(
      (s) => s.promptLocked,
    ).length ?? 0;
  const samplePrompt =
    production.activeStoryboard?.scenes[0]?.shots[0]?.videoPrompt?.slice(
      0,
      120,
    ) ?? "";

  console.info(
    JSON.stringify(
      {
        ok: result.ok,
        status: production.status,
        generationError: production.generationError,
        shotCount,
        lockedCount,
        samplePrompt,
        ruleVersion:
          production.activeStoryboard?.scenes[0]?.shots[0]
            ?.storyboardPromptRuleVersion ?? null,
        durationSeconds:
          production.activeStoryboard?.scenes[0]?.shots[0]?.durationSeconds ??
          null,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
