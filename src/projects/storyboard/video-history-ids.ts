import type {
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";

type IdGroup =
  | string
  | null
  | undefined
  | readonly (string | null | undefined)[];

/** 去重并保持顺序（先出现的优先）；用于追加历史 ID。 */
export function uniqueGenerationIds(...groups: IdGroup[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (group == null) continue;
    const list = typeof group === "string" ? [group] : group;
    for (const id of list) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 新成功生成追加到镜头历史（最新在前）。 */
export function appendShotVideoHistory(
  shot: StoryboardShot,
  generationId: string,
): StoryboardShot {
  return {
    ...shot,
    lastGenerationId: generationId,
    videoHistoryGenerationIds: uniqueGenerationIds(
      generationId,
      shot.videoHistoryGenerationIds,
      shot.lastGenerationId,
    ),
  };
}

/** 分镜文档级历史：本集所有曾成功提交的生成，永不丢弃。 */
export function appendStoryboardVideoHistory(
  storyboard: StoryboardDocument,
  generationIds: string[],
): StoryboardDocument {
  return {
    ...storyboard,
    videoHistoryGenerationIds: uniqueGenerationIds(
      generationIds,
      storyboard.videoHistoryGenerationIds,
    ),
  };
}

/**
 * 镜头预览应加载的全部 generationId：
 * - 本镜头历史 / lastGenerationId
 * - 本集文档归档历史（含结构变化后的孤儿视频）
 */
export function collectVideoHistoryGenerationIds(params: {
  shot: StoryboardShot;
  storyboard: StoryboardDocument;
}): string[] {
  return uniqueGenerationIds(
    params.shot.videoHistoryGenerationIds,
    params.shot.lastGenerationId,
    params.storyboard.videoHistoryGenerationIds,
  );
}

/** 合并重生时携带镜头历史；未被匹配到的旧镜头历史并入文档归档。 */
export function collectPreviousVideoHistoryIds(
  previous: StoryboardDocument,
): {
  byKey: Map<string, string[]>;
  documentIds: string[];
} {
  const byKey = new Map<string, string[]>();
  const allFromShots: string[] = [];
  for (const scene of previous.scenes) {
    scene.shots.forEach((shot, index) => {
      const ids = uniqueGenerationIds(
        shot.videoHistoryGenerationIds,
        shot.lastGenerationId,
      );
      byKey.set(`${scene.sceneNumber}:${index}`, ids);
      allFromShots.push(...ids);
    });
  }
  return {
    byKey,
    documentIds: uniqueGenerationIds(
      previous.videoHistoryGenerationIds,
      allFromShots,
    ),
  };
}
