import { randomUUID } from "crypto";
import type { ScriptEpisode } from "@/projects/script/types";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";
import { carryStoryboardRemoteRevision } from "@/projects/storyboard/remote-production-store";

function nowIso(): string {
  return new Date().toISOString();
}

function createEpisodeProduction(
  projectId: string,
  episode: ScriptEpisode,
): EpisodeProduction {
  const now = nowIso();
  return {
    id: `prod_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    projectId,
    episodeId: episode.id,
    episodeNumber: episode.episodeNumber,
    currentStep: 1,
    status: "awaiting_script",
    workingScriptText: episode.content,
    workingScriptRevision: 1,
    confirmedScriptText: null,
    confirmedScriptRevision: null,
    confirmedScriptHash: null,
    scriptConfirmedAt: null,
    scriptConfirmedBy: null,
    assetMatches: [],
    confirmedAssetSnapshotHash: null,
    assetsConfirmedAt: null,
    assetsConfirmedBy: null,
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: null,
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveActiveEpisodeId(
  episodes: ScriptEpisode[],
  productions: EpisodeProduction[],
  previousActiveId: string | null,
): string | null {
  if (productions.length === 0) return null;

  const byEpisodeId = new Map(
    productions.map((production) => [production.episodeId, production]),
  );

  if (previousActiveId) {
    const previous = byEpisodeId.get(previousActiveId);
    if (previous && previous.status !== "storyboard_done") {
      return previousActiveId;
    }
  }

  for (const episode of episodes) {
    const production = byEpisodeId.get(episode.id);
    if (production && production.status !== "storyboard_done") {
      return episode.id;
    }
  }

  const lastEdited = [...productions].sort(
    (a, b) => b.lastEditedAt.localeCompare(a.lastEditedAt),
  )[0];
  if (lastEdited) return lastEdited.episodeId;

  return episodes[0]?.id ?? productions[0]?.episodeId ?? null;
}

/**
 * Ensure each script episode has a corresponding EpisodeProduction.
 * Preserves existing rows (including orphans when episodes are removed).
 */
export function ensureEpisodeProductions(
  projectId: string,
  episodes: ScriptEpisode[],
  existing: ProjectStoryboardWorkspace | null,
): ProjectStoryboardWorkspace {
  const existingProductions = existing?.productions ?? [];
  const byEpisodeId = new Map(
    existingProductions.map((production) => [production.episodeId, production]),
  );

  const nextProductions: EpisodeProduction[] = [...existingProductions];

  for (const episode of episodes) {
    if (byEpisodeId.has(episode.id)) continue;
    const created = createEpisodeProduction(projectId, episode);
    nextProductions.push(created);
    byEpisodeId.set(episode.id, created);
  }

  const activeEpisodeId = resolveActiveEpisodeId(
    episodes,
    nextProductions,
    existing?.activeEpisodeId ?? null,
  );

  return carryStoryboardRemoteRevision(existing, {
    projectId,
    activeEpisodeId,
    productions: nextProductions,
    updatedAt: nowIso(),
  });
}
