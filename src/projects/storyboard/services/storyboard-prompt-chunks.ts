import type { StoryboardDocument, StoryboardShot } from "@/projects/storyboard/types";

/** Prefer 2–4 shots per plot sub-chunk; batch LLM calls stay within this. */
export const STORYBOARD_PROMPT_CHUNK_SHOT_MAX = 4;
/** Below this unlocked shot count, keep one chunk and may send full script. */
export const STORYBOARD_PROMPT_SHORT_SHOT_THRESHOLD = 4;

export type StoryboardPromptChunkTarget = {
  shot: StoryboardShot;
  sceneTitle: string;
};

/** Context embedded in each LLM batch (no character-sliced script). */
export type PlotChunkPromptContext = {
  sceneTitle: string;
  location: string;
  timeOfDay: string;
  chunkBody: string;
  prevEndingSummary: string;
  nextPlotGoal: string;
  characterState: string;
  openThreads: string;
  shotIds: string[];
  shotNumbers: number[];
  /** Short scripts may still attach full episode scriptText. */
  useFullScript: boolean;
};

export type StoryboardPromptChunk = PlotChunkPromptContext & {
  targets: StoryboardPromptChunkTarget[];
};

export type StoryboardPromptChunkCharacterHint = {
  name: string;
  role?: string;
};

function sceneTitleOf(scene: {
  title: string;
  location: string;
}): string {
  return scene.title?.trim() || scene.location?.trim() || "场景";
}

function summarizeShot(shot: StoryboardShot): string {
  const parts = [
    `镜${String(shot.shotNumber).padStart(2, "0")}`,
    shot.visualDescription?.trim() || shot.actionDescription?.trim() || "",
    shot.dialogue?.trim() ? `台词「${shot.dialogue.trim()}」` : "",
  ].filter(Boolean);
  return parts.join("：").replace(/：：/g, "：");
}

function buildChunkBody(shots: StoryboardShot[]): string {
  return shots
    .map((shot) => {
      const source =
        shot.sourceScriptText?.trim() ||
        [
          shot.visualDescription?.trim(),
          shot.actionDescription?.trim(),
          shot.dialogue?.trim(),
        ]
          .filter(Boolean)
          .join("\n");
      const lines = [
        `【镜头 ${String(shot.shotNumber).padStart(2, "0")}】`,
        source ? `原文：${source}` : "",
        shot.dialogue?.trim()
          ? `台词（须逐字保留）：${shot.dialogue.trim()}`
          : "",
        shot.requiredCharacters?.length
          ? `人物：${shot.requiredCharacters.join("、")}`
          : "",
        shot.requiredProps?.length
          ? `道具：${shot.requiredProps.join("、")}`
          : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildCharacterState(
  shots: StoryboardShot[],
  characterHints?: StoryboardPromptChunkCharacterHint[],
): string {
  const names = [
    ...new Set(
      shots.flatMap((s) =>
        (s.requiredCharacters ?? []).map((n) => n.trim()).filter(Boolean),
      ),
    ),
  ];
  if (names.length === 0) return "本块无明显人物名单";
  const hintByName = new Map(
    (characterHints ?? [])
      .map((h) => [h.name.trim(), h] as const)
      .filter(([name]) => Boolean(name)),
  );
  return names
    .map((name) => {
      const hint = hintByName.get(name);
      const role = hint?.role?.trim();
      return role ? `${name}（${role}）` : name;
    })
    .join("、");
}

function buildOpenThreads(shots: StoryboardShot[]): string {
  const props = [
    ...new Set(
      shots.flatMap((s) =>
        (s.requiredProps ?? []).map((n) => n.trim()).filter(Boolean),
      ),
    ),
  ];
  const actions = shots
    .map((s) => s.actionDescription?.trim())
    .filter(Boolean)
    .slice(-2);
  const parts: string[] = [];
  if (props.length > 0) parts.push(`道具：${props.join("、")}`);
  if (actions.length > 0) parts.push(`未完动作：${actions.join("；")}`);
  return parts.join("。") || "无";
}

/**
 * Split one scene's unlocked shots into 2–4 shot sub-chunks (tail may be 1).
 * Never crosses scene boundaries.
 */
export function splitSceneShotTargets(
  targets: StoryboardPromptChunkTarget[],
  maxPerChunk = STORYBOARD_PROMPT_CHUNK_SHOT_MAX,
): StoryboardPromptChunkTarget[][] {
  if (targets.length === 0) return [];
  if (targets.length <= maxPerChunk) return [targets];
  const chunks: StoryboardPromptChunkTarget[][] = [];
  let i = 0;
  while (i < targets.length) {
    const remaining = targets.length - i;
    let size = Math.min(maxPerChunk, remaining);
    // Prefer not leaving a lone trailing shot when we can take 3 then 2, etc.
    if (remaining > maxPerChunk && remaining - size === 1) {
      size = Math.max(2, size - 1);
    }
    chunks.push(targets.slice(i, i + size));
    i += size;
  }
  return chunks;
}

function endingSummaryFromTargets(
  targets: StoryboardPromptChunkTarget[],
  take = 2,
): string {
  if (targets.length === 0) return "";
  const slice = targets.slice(-take);
  return slice.map((t) => summarizeShot(t.shot)).join("；");
}

function nextGoalFromTargets(
  targets: StoryboardPromptChunkTarget[],
): string {
  if (targets.length === 0) return "";
  const first = targets[0]!;
  const visual =
    first.shot.visualDescription?.trim() ||
    first.shot.actionDescription?.trim() ||
    "";
  return [`进入「${first.sceneTitle}」`, visual ? `：${visual}` : ""]
    .join("")
    .trim();
}

/**
 * Plan semantic plot chunks from the existing storyboard scene tree.
 * Does not character-slice scriptText.
 */
export function buildStoryboardPromptChunks(input: {
  storyboard: StoryboardDocument;
  /** Unused for slicing; retained for short-script full-script path callers. */
  scriptText?: string | null;
  characterHints?: StoryboardPromptChunkCharacterHint[];
  /** When set, only these unlocked targets are chunked (default: all unlocked). */
  targets?: StoryboardPromptChunkTarget[];
}): StoryboardPromptChunk[] {
  const unlocked =
    input.targets ??
    (() => {
      const list: StoryboardPromptChunkTarget[] = [];
      for (const scene of input.storyboard.scenes) {
        const sceneTitle = sceneTitleOf(scene);
        for (const shot of scene.shots) {
          if (shot.promptLocked || shot.locked) continue;
          list.push({ shot, sceneTitle });
        }
      }
      return list;
    })();

  if (unlocked.length === 0) return [];

  const useFullScript =
    unlocked.length < STORYBOARD_PROMPT_SHORT_SHOT_THRESHOLD;

  // Short path: one chunk, full script allowed.
  if (useFullScript) {
    const firstScene = input.storyboard.scenes.find((scene) =>
      scene.shots.some((s) => unlocked.some((t) => t.shot.id === s.id)),
    );
    return [
      {
        sceneTitle: unlocked[0]!.sceneTitle,
        location: firstScene?.location?.trim() || "",
        timeOfDay: firstScene?.timeOfDay?.trim() || "",
        chunkBody: buildChunkBody(unlocked.map((t) => t.shot)),
        prevEndingSummary: "",
        nextPlotGoal: "",
        characterState: buildCharacterState(
          unlocked.map((t) => t.shot),
          input.characterHints,
        ),
        openThreads: buildOpenThreads(unlocked.map((t) => t.shot)),
        shotIds: unlocked.map((t) => t.shot.id),
        shotNumbers: unlocked.map((t) => t.shot.shotNumber),
        useFullScript: true,
        targets: unlocked,
      },
    ];
  }

  // Group by scene order without crossing scenes.
  type SceneGroup = {
    sceneTitle: string;
    location: string;
    timeOfDay: string;
    sceneSummary: string;
    targets: StoryboardPromptChunkTarget[];
  };

  const groups: SceneGroup[] = [];
  for (const scene of input.storyboard.scenes) {
    const sceneTitle = sceneTitleOf(scene);
    const sceneTargets = unlocked.filter((t) =>
      scene.shots.some((s) => s.id === t.shot.id),
    );
    if (sceneTargets.length === 0) continue;
    groups.push({
      sceneTitle,
      location: scene.location?.trim() || "",
      timeOfDay: scene.timeOfDay?.trim() || "",
      sceneSummary: scene.summary?.trim() || "",
      targets: sceneTargets,
    });
  }

  // Orphan unlocked shots not found in scenes (defensive).
  const groupedIds = new Set(groups.flatMap((g) => g.targets.map((t) => t.shot.id)));
  const orphans = unlocked.filter((t) => !groupedIds.has(t.shot.id));
  if (orphans.length > 0) {
    groups.push({
      sceneTitle: orphans[0]!.sceneTitle,
      location: "",
      timeOfDay: "",
      sceneSummary: "",
      targets: orphans,
    });
  }

  type FlatSub = {
    groupIndex: number;
    targets: StoryboardPromptChunkTarget[];
    location: string;
    timeOfDay: string;
    sceneTitle: string;
    sceneSummary: string;
  };

  const subs: FlatSub[] = [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi]!;
    for (const part of splitSceneShotTargets(group.targets)) {
      subs.push({
        groupIndex: gi,
        targets: part,
        location: group.location,
        timeOfDay: group.timeOfDay,
        sceneTitle: group.sceneTitle,
        sceneSummary: group.sceneSummary,
      });
    }
  }

  return subs.map((sub, index) => {
    const prev = index > 0 ? subs[index - 1]! : null;
    const next = index < subs.length - 1 ? subs[index + 1]! : null;

    let prevEndingSummary = "";
    if (prev) {
      // 1-shot overlap into summary only (same scene sub-chunks).
      prevEndingSummary = endingSummaryFromTargets(prev.targets, 1);
      if (prev.groupIndex !== sub.groupIndex && prev.sceneSummary) {
        prevEndingSummary = [prev.sceneSummary, prevEndingSummary]
          .filter(Boolean)
          .join("；");
      }
    }

    const nextPlotGoal = next ? nextGoalFromTargets(next.targets) : "";

    return {
      sceneTitle: sub.sceneTitle,
      location: sub.location,
      timeOfDay: sub.timeOfDay,
      chunkBody: buildChunkBody(sub.targets.map((t) => t.shot)),
      prevEndingSummary,
      nextPlotGoal,
      characterState: buildCharacterState(
        sub.targets.map((t) => t.shot),
        input.characterHints,
      ),
      openThreads: buildOpenThreads(sub.targets.map((t) => t.shot)),
      shotIds: sub.targets.map((t) => t.shot.id),
      shotNumbers: sub.targets.map((t) => t.shot.shotNumber),
      useFullScript: false,
      targets: sub.targets,
    };
  });
}

/** Build a mini chunk context for single-shot regeneration. */
export function buildMiniChunkForShot(input: {
  storyboard: StoryboardDocument;
  shotId: string;
  characterHints?: StoryboardPromptChunkCharacterHint[];
}): StoryboardPromptChunk | null {
  for (const scene of input.storyboard.scenes) {
    const idx = scene.shots.findIndex((s) => s.id === input.shotId);
    if (idx < 0) continue;
    const shot = scene.shots[idx]!;
    const sceneTitle = sceneTitleOf(scene);
    const target: StoryboardPromptChunkTarget = { shot, sceneTitle };
    const prevShots = scene.shots.slice(Math.max(0, idx - 1), idx);
    const nextShots = scene.shots.slice(idx + 1, idx + 2);
    return {
      sceneTitle,
      location: scene.location?.trim() || "",
      timeOfDay: scene.timeOfDay?.trim() || "",
      chunkBody: buildChunkBody([shot]),
      prevEndingSummary: prevShots.map(summarizeShot).join("；"),
      nextPlotGoal: nextShots.length
        ? nextGoalFromTargets(
            nextShots.map((s) => ({ shot: s, sceneTitle })),
          )
        : "",
      characterState: buildCharacterState([shot], input.characterHints),
      openThreads: buildOpenThreads([shot]),
      shotIds: [shot.id],
      shotNumbers: [shot.shotNumber],
      useFullScript: false,
      targets: [target],
    };
  }
  return null;
}

/** Fallback mini chunk when full storyboard is unavailable. */
export function buildLocalPlotChunkForShot(input: {
  shot: StoryboardShot;
  sceneTitle: string;
  characterHints?: StoryboardPromptChunkCharacterHint[];
}): PlotChunkPromptContext {
  return {
    sceneTitle: input.sceneTitle,
    location: "",
    timeOfDay: "",
    chunkBody: buildChunkBody([input.shot]),
    prevEndingSummary: "",
    nextPlotGoal: "",
    characterState: buildCharacterState([input.shot], input.characterHints),
    openThreads: buildOpenThreads([input.shot]),
    shotIds: [input.shot.id],
    shotNumbers: [input.shot.shotNumber],
    useFullScript: false,
  };
}
