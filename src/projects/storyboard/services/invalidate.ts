import type { EpisodeProduction } from "@/projects/storyboard/types";

function markStoryboardStale(
  production: EpisodeProduction,
  now: string,
): EpisodeProduction["activeStoryboard"] {
  if (production.activeStoryboard === null) return null;
  return {
    ...production.activeStoryboard,
    status: "stale",
    updatedAt: now,
  };
}

/**
 * After a confirmed script is changed/saved: keep existing storyboard usable,
 * mark it advisory-stale, and stay on storyboard creation so users can continue
 * or optionally regenerate prompts (whole board or per shot).
 */
export function invalidateAfterScriptChange(
  production: EpisodeProduction,
): EpisodeProduction {
  const now = new Date().toISOString();
  const hasDownstream =
    production.assetMatches.length > 0 ||
    production.assetsConfirmedAt !== null ||
    production.activeStoryboard !== null ||
    production.confirmedScriptText !== null;

  if (!hasDownstream && production.currentStep === 1) {
    return {
      ...production,
      updatedAt: now,
      lastEditedAt: now,
    };
  }

  return {
    ...production,
    assetsStale: true,
    storyboardStale: true,
    activeStoryboard: markStoryboardStale(production, now),
    currentStep: 2,
    // Keep shots editable; do not force a full regenerate gate.
    status: production.activeStoryboard
      ? "storyboard_incomplete"
      : "awaiting_storyboard",
    assetsConfirmedAt: null,
    assetsConfirmedBy: null,
    confirmedAssetSnapshotHash: null,
    updatedAt: now,
    lastEditedAt: now,
  };
}

/** Alias used by confirm-script when reconfirming after downstream work. */
export function invalidateOnScriptReconfirm(
  production: EpisodeProduction,
): EpisodeProduction {
  return invalidateAfterScriptChange(production);
}

/** Mark storyboard stale after assets are reconfirmed (legacy path). */
export function invalidateOnAssetsReconfirm(
  production: EpisodeProduction,
): EpisodeProduction {
  const now = new Date().toISOString();
  return {
    ...production,
    storyboardStale: true,
    activeStoryboard: markStoryboardStale(production, now),
    updatedAt: now,
    lastEditedAt: now,
  };
}
