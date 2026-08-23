import type {
  EpisodeProduction,
  StoryboardShot,
} from "@/projects/storyboard/types";

export const PROMPT_REFRESH_NOTICE =
  "提示词已根据剧本更新，现有制作结果保留";

export type PromptRefreshMeta = {
  scriptRevision: number;
  updatedAt: string;
  appliedShotIds: string[];
  reviewShotIds: string[];
  notice: string;
};

export function buildAutoVideoPrompt(input: {
  snippet: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  composition: string;
  sceneTitle: string;
  dialogue: string;
  durationSeconds: number;
  requiredCharacters: string[];
  requiredProps: string[];
}): string {
  const people =
    input.requiredCharacters.length > 0
      ? input.requiredCharacters.join("、")
      : "主要人物";
  const props =
    input.requiredProps.length > 0
      ? input.requiredProps.join("、")
      : "无特殊道具";
  return [
    `景别：${input.shotSize}。`,
    `镜头角度：${input.cameraAngle}。`,
    `构图：${input.composition}。`,
    `运镜：${input.cameraMovement}。`,
    `场景环境：${input.sceneTitle}。`,
    `人物：${people}。`,
    `动作与画面：${input.snippet.slice(0, 120) || "动作待补充"}。`,
    `道具：${props}。`,
    `光影：自然可信，突出主体。`,
    input.dialogue ? `台词：${input.dialogue}。` : "台词：无。",
    `镜头时长：${input.durationSeconds} 秒。`,
  ].join("\n");
}

function scriptSnippets(scriptText: string, count: number): string[] {
  const trimmed = scriptText.trim();
  if (!trimmed) return Array.from({ length: count }, () => "");
  const parts = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return Array.from({ length: count }, () => trimmed);
  return Array.from({ length: count }, (_, i) => {
    return parts[Math.min(i, parts.length - 1)] ?? trimmed;
  });
}

function isManuallyProtected(shot: StoryboardShot): boolean {
  return (
    shot.manuallyEdited === true ||
    shot.promptLocked === true ||
    shot.locked === true ||
    shot.promptOrigin === "manual"
  );
}

function refreshShot(input: {
  shot: StoryboardShot;
  snippet: string;
  sceneTitle: string;
  scriptRevision: number;
  now: string;
}): { shot: StoryboardShot; applied: boolean; needsReview: boolean } {
  const autoPrompt = buildAutoVideoPrompt({
    snippet: input.snippet || input.shot.actionDescription || input.shot.visualDescription,
    shotSize: input.shot.shotSize,
    cameraAngle: input.shot.cameraAngle,
    cameraMovement: input.shot.cameraMovement,
    composition: input.shot.composition,
    sceneTitle: input.sceneTitle,
    dialogue: input.shot.dialogue,
    durationSeconds: input.shot.durationSeconds,
    requiredCharacters: input.shot.requiredCharacters,
    requiredProps: input.shot.requiredProps,
  });
  const nextVersion = (input.shot.promptVersion ?? 1) + 1;
  const hasResult = Boolean(
    input.shot.lastGenerationId ||
      input.shot.lastVideoContentHash ||
      (input.shot.videoHistoryGenerationIds?.length ?? 0) > 0,
  );

  if (isManuallyProtected(input.shot)) {
    return {
      needsReview: true,
      applied: false,
      shot: {
        ...input.shot,
        autoPromptText: autoPrompt,
        promptNeedsReview: true,
        promptScriptRevision: input.scriptRevision,
        promptUpdatedAt: input.now,
        videoContentStale: hasResult ? true : input.shot.videoContentStale,
      },
    };
  }

  return {
    needsReview: false,
    applied: true,
    shot: {
      ...input.shot,
      visualDescription:
        input.snippet.slice(0, 120) || input.shot.visualDescription,
      actionDescription:
        input.snippet.slice(0, 80) || input.shot.actionDescription,
      promptDraft: autoPrompt,
      videoPrompt: autoPrompt,
      autoPromptText: autoPrompt,
      promptOrigin: "auto",
      promptVersion: nextVersion,
      promptUpdatedAt: input.now,
      promptScriptRevision: input.scriptRevision,
      promptNeedsReview: false,
      videoContentStale: hasResult ? true : input.shot.videoContentStale,
    },
  };
}

export function refreshProductionPrompts(input: {
  production: EpisodeProduction;
  scriptText: string;
  scriptRevision: number;
}): EpisodeProduction {
  const storyboard = input.production.activeStoryboard;
  if (!storyboard) {
    return {
      ...input.production,
      promptRefresh: {
        scriptRevision: input.scriptRevision,
        updatedAt: new Date().toISOString(),
        appliedShotIds: [],
        reviewShotIds: [],
        notice: PROMPT_REFRESH_NOTICE,
      },
    };
  }
  if (input.production.promptRefresh?.scriptRevision === input.scriptRevision) {
    return input.production;
  }

  const now = new Date().toISOString();
  const shotCount = storyboard.scenes.reduce(
    (n, scene) => n + scene.shots.length,
    0,
  );
  const snippets = scriptSnippets(input.scriptText, Math.max(1, shotCount));
  const appliedShotIds: string[] = [];
  const reviewShotIds: string[] = [];
  let cursor = 0;
  const scenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      const snippet = snippets[Math.min(cursor, snippets.length - 1)] ?? "";
      cursor += 1;
      const result = refreshShot({
        shot,
        snippet,
        sceneTitle: scene.title,
        scriptRevision: input.scriptRevision,
        now,
      });
      if (result.applied) appliedShotIds.push(result.shot.id);
      if (result.needsReview) reviewShotIds.push(result.shot.id);
      return result.shot;
    }),
  }));

  return {
    ...input.production,
    promptRefresh: {
      scriptRevision: input.scriptRevision,
      updatedAt: now,
      appliedShotIds,
      reviewShotIds,
      notice: PROMPT_REFRESH_NOTICE,
    },
    activeStoryboard: {
      ...storyboard,
      scenes,
      updatedAt: now,
      revision: storyboard.revision,
    },
  };
}

export function markShotPromptManual(
  shot: StoryboardShot,
  videoPrompt: string,
): StoryboardShot {
  return {
    ...shot,
    videoPrompt,
    promptDraft: videoPrompt,
    promptOrigin: "manual",
    promptNeedsReview: false,
    promptUpdatedAt: new Date().toISOString(),
    promptVersion: (shot.promptVersion ?? 1) + 1,
    manuallyEdited: true,
  };
}
