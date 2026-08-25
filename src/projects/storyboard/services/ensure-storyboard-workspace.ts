import "server-only";

import { findProduction } from "@/projects/storyboard/api-helpers";
import { stableHash } from "@/projects/storyboard/hash";
import {
  loadWorkspace,
  updateWorkspaceUnderLock,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";

export async function ensureStoryboardWorkspaceReady(input: {
  projectId: string;
  episodeId: string;
  userId: string;
}): Promise<{ workspace: ProjectStoryboardWorkspace; production: EpisodeProduction }> {
  const script = await loadScriptDraft(input.projectId);
  const episodes = script?.episodes ?? [];
  const episode = episodes.find((item) => item.id === input.episodeId);
  if (!episode) {
    throw new Error("剧集不存在");
  }

  const scriptConfirmed = script?.episodeSplit?.status === "confirmed";
  const now = new Date().toISOString();

  const workspace = await updateWorkspaceUnderLock(input.projectId, async (existing) => {
    const base = ensureEpisodeProductions(input.projectId, episodes, existing);
    const productions = base.productions.map((production) => {
      if (production.episodeId !== input.episodeId) return production;
      const workingScriptText = episode.content;
      if (production.confirmedScriptText?.trim()) {
        return {
          ...production,
          workingScriptText,
          lastEditedAt: now,
          updatedAt: now,
        };
      }
      if (!scriptConfirmed) {
        return {
          ...production,
          workingScriptText,
          lastEditedAt: now,
          updatedAt: now,
        };
      }
      return {
        ...production,
        workingScriptText,
        confirmedScriptText: workingScriptText,
        confirmedScriptRevision: production.workingScriptRevision,
        confirmedScriptHash: stableHash(workingScriptText),
        scriptConfirmedAt: production.scriptConfirmedAt ?? now,
        scriptConfirmedBy: production.scriptConfirmedBy ?? input.userId,
        currentStep: 2 as const,
        status: "awaiting_storyboard" as const,
        revision: production.revision + 1,
        lastEditedAt: now,
        updatedAt: now,
      };
    });
    return {
      ...base,
      productions,
      updatedAt: now,
    };
  });

  if (!workspace) {
    throw new Error("无法初始化分镜工作台");
  }

  const production = findProduction(workspace, input.episodeId);
  if (!production) {
    throw new Error("分集制作不存在");
  }

  return { workspace, production };
}

export async function loadStoryboardProduction(input: {
  projectId: string;
  episodeId: string;
}): Promise<EpisodeProduction | null> {
  const workspace = await loadWorkspace(input.projectId);
  return workspace ? (findProduction(workspace, input.episodeId) ?? null) : null;
}
