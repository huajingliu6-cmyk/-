import { randomUUID } from "crypto";
import type {
  AssetMatchItem,
  ShotAssetRequirement,
  StoryboardDocument,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";
import {
  assignContinuousEpisodeShotNumbers,
  buildRequirementsFromNames,
} from "@/projects/storyboard/shot-completeness";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import {
  cleanSceneRequirementName,
  dedupeShotRequirements,
} from "@/projects/storyboard/shot-completeness";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import {
  autoLinkShotToLibrary,
  collectLibraryNamesInText,
} from "@/projects/storyboard/services/shot-library-match";
import {
  collectPreviousVideoHistoryIds,
  uniqueGenerationIds,
} from "@/projects/storyboard/video-history-ids";
import { STORYBOARD_VIDEO_DURATION_MIN } from "@/projects/storyboard/storyboard-video-params";

export type GenerateStructuredStoryboardInput = {
  scriptText: string;
  assetMatches: AssetMatchItem[];
  /** Project library assets used to auto-bind per-shot materials. */
  libraryAssets?: MatchableAssets | null;
  sourceScriptHash: string;
  sourceAssetSnapshotHash: string;
  userId: string;
};

const SCENE_HEADER =
  /^(?:INT|EXT|内景|外景|场景[：:])/im;

function splitScriptBlocks(scriptText: string): string[] {
  const trimmed = scriptText.trim();
  if (!trimmed) return ["（暂无剧本内容）"];

  const byParagraph = trimmed
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const blocks: string[] = [];
  for (const block of byParagraph) {
    const lines = block.split(/\n/);
    let chunk: string[] = [];
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (SCENE_HEADER.test(text) && chunk.length > 0) {
        blocks.push(chunk.join("\n"));
        chunk = [text];
      } else {
        chunk.push(text);
      }
    }
    if (chunk.length > 0) blocks.push(chunk.join("\n"));
  }

  if (blocks.length === 0) return [trimmed];
  if (blocks.length === 1 && blocks[0]!.length > 120) {
    const sentences = blocks[0]!
      .split(/(?<=[。！？!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 2) {
      const mid = Math.ceil(sentences.length / 2);
      return [sentences.slice(0, mid).join(""), sentences.slice(mid).join("")];
    }
  }
  return blocks;
}

function clampSceneCount(blocks: string[]): string[] {
  if (blocks.length <= 1) {
    const text = blocks[0] ?? "";
    const half = Math.max(1, Math.floor(text.length / 2));
    if (text.length > 40) {
      return [text.slice(0, half).trim(), text.slice(half).trim()].filter(Boolean);
    }
    return blocks.length > 0 ? blocks : ["（场景一）", "（场景二）"];
  }
  if (blocks.length <= 4) return blocks;
  const merged: string[] = [];
  const groupSize = Math.ceil(blocks.length / 4);
  for (let i = 0; i < blocks.length; i += groupSize) {
    merged.push(blocks.slice(i, i + groupSize).join("\n\n"));
  }
  return merged.slice(0, 4);
}

function splitShots(sceneText: string): string[] {
  const lines = sceneText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    return lines.slice(0, 4);
  }
  const sentences = sceneText
    .split(/(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length >= 2) {
    return sentences.slice(0, 4);
  }
  const chunkSize = Math.max(1, Math.ceil(sceneText.length / 3));
  const chunks: string[] = [];
  for (let i = 0; i < sceneText.length && chunks.length < 4; i += chunkSize) {
    chunks.push(sceneText.slice(i, i + chunkSize).trim());
  }
  return chunks.filter(Boolean).length > 0 ? chunks.filter(Boolean) : [sceneText];
}

function parseSceneMeta(block: string): Pick<
  StoryboardScene,
  "title" | "location" | "timeOfDay" | "interiorExterior"
> {
  const firstLine = block.split(/\n/)[0]?.trim() ?? "";
  const sceneLabel = firstLine.match(/场景[：:]\s*(.+)/)?.[1]?.trim();
  const intExt = firstLine.match(/^(INT|EXT|内景|外景)/i)?.[1]?.toUpperCase();
  let interiorExterior: StoryboardScene["interiorExterior"] = "未知";
  if (intExt === "INT" || intExt === "内景") interiorExterior = "INT";
  if (intExt === "EXT" || intExt === "外景") interiorExterior = "EXT";

  const location =
    sceneLabel ??
    firstLine.match(/(?:INT|EXT|内景|外景)[\s/·\-—]*(.+)/i)?.[1]?.trim() ??
    (firstLine.slice(0, 24) || "未命名场景");

  return {
    title: location,
    location,
    timeOfDay: "日",
    interiorExterior,
  };
}

function matchedAssetIds(
  matches: AssetMatchItem[],
  assetType: AssetMatchItem["assetType"],
): string[] {
  return matches
    .filter(
      (item) =>
        item.assetType === assetType &&
        item.matchedAssetId &&
        (item.confidence === "high" || item.confidence === "possible"),
    )
    .map((item) => item.matchedAssetId!)
    .filter((id, index, list) => list.indexOf(id) === index);
}

function extractNamesFromSnippet(
  snippet: string,
  sceneLocation: string,
  assetMatches: AssetMatchItem[],
  libraryAssets?: MatchableAssets | null,
): {
  requiredCharacters: string[];
  requiredProps: string[];
  requiredScene: string | null;
} {
  const characters = new Set<string>();
  const props = new Set<string>();
  const scenes = new Set<string>();

  for (const m of assetMatches) {
    if (m.assetType === "character" && snippet.includes(m.extractedName)) {
      characters.add(m.extractedName);
    }
    if (m.assetType === "prop" && snippet.includes(m.extractedName)) {
      props.add(m.extractedName);
    }
    if (m.assetType === "scene" && snippet.includes(m.extractedName)) {
      scenes.add(m.extractedName);
    }
  }

  if (libraryAssets) {
    const fromLibrary = collectLibraryNamesInText(snippet, libraryAssets);
    for (const name of fromLibrary.characters) characters.add(name);
    for (const name of fromLibrary.props) props.add(name);
    for (const name of fromLibrary.scenes) scenes.add(name);
  }

  const nameHits = snippet.match(/[\u4e00-\u9fff]{2,4}(?=出场|走来|说道|说：「|望向)/g);
  for (const name of nameHits ?? []) {
    characters.add(name);
  }

  const propLine = snippet.match(/道具[：:]\s*([^\n。]+)/)?.[1];
  if (propLine) {
    for (const part of propLine.split(/[、,，/]/)) {
      const t = part.trim();
      if (t) props.add(t);
    }
  }

  const umbrella = snippet.match(/([\u4e00-\u9fff]*伞)/)?.[1];
  if (umbrella) props.add(umbrella);

  const rawScene =
    [...scenes][0] ??
    (sceneLocation && sceneLocation !== "未命名场景" ? sceneLocation : null);
  const requiredScene = rawScene
    ? cleanSceneRequirementName(rawScene) || rawScene
    : null;

  return {
    requiredCharacters: [...characters],
    requiredProps: [...props],
    requiredScene,
  };
}

function buildVideoPrompt(input: {
  snippet: string;
  shotNumber: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  composition: string;
  sceneTitle: string;
  dialogue: string;
  durationSeconds: number;
  requiredCharacters: string[];
  requiredProps: string[];
  lighting?: string;
}): string {
  const people =
    input.requiredCharacters.length > 0
      ? input.requiredCharacters.join("、")
      : "主要人物";
  const props =
    input.requiredProps.length > 0
      ? input.requiredProps.join("、")
      : "无特殊道具";
  const lighting = input.lighting ?? "自然可信，突出主体。";
  return [
    `景别：${input.shotSize}。`,
    `镜头角度：${input.cameraAngle}。`,
    `构图：${input.composition}。`,
    `运镜：${input.cameraMovement}。`,
    `场景环境：${input.sceneTitle}。`,
    `人物：${people}。`,
    `动作与画面：${input.snippet.slice(0, 120) || "动作待补充"}。`,
    `道具：${props}。`,
    `光影：${lighting}`,
    input.dialogue ? `台词：${input.dialogue}。` : "台词：无。",
    `镜头时长：${input.durationSeconds} 秒。`,
  ].join("\n");
}

const LIGHTING_VARIANTS = [
  "自然可信，突出主体。",
  "侧逆光勾勒轮廓，层次分明。",
  "柔和散射光，氛围统一。",
  "低对比度环境光，保留细节。",
] as const;

function lightingFromSalt(salt: string): string {
  let hash = 0;
  for (let i = 0; i < salt.length; i += 1) {
    hash = (hash * 31 + salt.charCodeAt(i)) >>> 0;
  }
  return LIGHTING_VARIANTS[hash % LIGHTING_VARIANTS.length]!;
}

/**
 * @deprecated 镜头内容已从前端移除；新分镜不再强制生成概述。
 * 保留函数供旧测试/兼容调用。
 */
export function buildShotSummary(input: {
  snippet: string;
  requiredCharacters: string[];
  location: string;
}): string {
  void input;
  return "";
}

/**
 * 仅重写当前镜头 videoPrompt；不改素材绑定、需求名与镜头元数据。
 * DEV Mock 与正式结构一致（景别/运镜/人物/道具/光影/台词/时长等）。
 */
export function regenerateVideoPromptForShot(
  shot: StoryboardShot,
  sceneTitle: string,
  salt: string,
): string {
  return buildVideoPrompt({
    snippet:
      shot.visualDescription ||
      shot.actionDescription ||
      shot.videoPrompt ||
      shot.promptDraft ||
      "",
    shotNumber: shot.shotNumber,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    composition: shot.composition || "主体居中，留出环境信息",
    sceneTitle: sceneTitle || shot.requiredScene || "场景",
    dialogue: shot.dialogue,
    durationSeconds: shot.durationSeconds,
    requiredCharacters: shot.requiredCharacters,
    requiredProps: shot.requiredProps,
    lighting: lightingFromSalt(salt),
  });
}

function linkRequirementsToMatches(
  requirements: ShotAssetRequirement[],
  assetMatches: AssetMatchItem[],
): {
  requirements: ShotAssetRequirement[];
  characterAssetIds: string[];
  propAssetIds: string[];
  sceneAssetId: string | null;
} {
  const characterAssetIds: string[] = [];
  const propAssetIds: string[] = [];
  let sceneAssetId: string | null = null;
  const next = requirements.map((req) => {
    const hit = assetMatches.find(
      (m) =>
        ((req.type === "character" && m.assetType === "character") ||
          (req.type === "prop" && m.assetType === "prop") ||
          (req.type === "scene" && m.assetType === "scene")) &&
        m.matchedAssetId &&
        (normalizeAssetName(m.extractedName) === req.normalizedName ||
          normalizeAssetName(m.matchedAssetName ?? "") === req.normalizedName),
    );
    if (!hit?.matchedAssetId) return req;
    if (req.type === "character") characterAssetIds.push(hit.matchedAssetId);
    if (req.type === "prop") propAssetIds.push(hit.matchedAssetId);
    if (req.type === "scene") sceneAssetId = hit.matchedAssetId;
    return {
      ...req,
      selectedAssetId: hit.matchedAssetId,
      resolution: "LINKED" as const,
      updatedAt: new Date().toISOString(),
    };
  });
  return {
    requirements: next,
    characterAssetIds: [...new Set(characterAssetIds)],
    propAssetIds: [...new Set(propAssetIds)],
    sceneAssetId,
  };
}

/**
 * 结构化分镜占位时长。真实时长以大模型 videoPrompt 头「总时长：N秒」为准，
 * 在 fillShotVideoPromptsWithLlm / 单镜重生成时回写到 shot.durationSeconds。
 */
function buildShot(
  snippet: string,
  shotNumber: number,
  order: number,
  assetMatches: AssetMatchItem[],
  sceneMeta: Pick<StoryboardScene, "title" | "location">,
  libraryAssets?: MatchableAssets | null,
): StoryboardShot {
  const dialogue =
    snippet.match(/「([^」]+)」/)?.[1] ??
    snippet.match(/(?:说|道)[：:]\s*(.+)/)?.[1]?.trim() ??
    "";
  const shotSize = shotNumber === 1 ? "全景" : "中景";
  const cameraAngle = "平视";
  const cameraMovement = shotNumber === 1 ? "缓慢推进" : "固定";
  const composition = "主体居中，留出环境信息";
  const durationSeconds = STORYBOARD_VIDEO_DURATION_MIN;
  const names = extractNamesFromSnippet(
    snippet,
    sceneMeta.location,
    assetMatches,
    libraryAssets,
  );
  let requirements = dedupeShotRequirements(
    buildRequirementsFromNames({
      characters: names.requiredCharacters,
      props: names.requiredProps,
      scene: names.requiredScene,
    }),
  );
  const linked = linkRequirementsToMatches(requirements, assetMatches);
  requirements = dedupeShotRequirements(linked.requirements);

  // Prefer per-requirement links. Do not stamp unrelated episode-level assets
  // onto every shot when a live library is available for name matching.
  const useLibrary = Boolean(
    libraryAssets &&
      (libraryAssets.characters.length > 0 ||
        libraryAssets.props.length > 0 ||
        libraryAssets.scenes.length > 0),
  );
  const fallbackChars = linked.characterAssetIds;
  const fallbackProps = linked.propAssetIds;
  const fallbackScene = linked.sceneAssetId;
  const softChars = useLibrary
    ? fallbackChars
    : fallbackChars.length > 0
      ? fallbackChars
      : matchedAssetIds(assetMatches, "character").slice(0, 2);
  const softProps = useLibrary
    ? fallbackProps
    : fallbackProps.length > 0
      ? fallbackProps
      : matchedAssetIds(assetMatches, "prop").slice(0, 2);

  const videoPrompt = buildVideoPrompt({
    snippet,
    shotNumber,
    shotSize,
    cameraAngle,
    cameraMovement,
    composition,
    sceneTitle: sceneMeta.title,
    dialogue,
    durationSeconds,
    requiredCharacters: names.requiredCharacters,
    requiredProps: names.requiredProps,
  });

  const shotSummary = "";

  let shot: StoryboardShot = {
    id: `shot_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    shotNumber,
    durationSeconds,
    shotSize,
    cameraAngle,
    cameraMovement,
    composition,
    visualDescription: snippet.slice(0, 120) || "画面待补充",
    actionDescription: snippet.slice(0, 80) || "动作待补充",
    dialogue,
    soundEffect: "",
    music: "",
    shotSummary,
    promptDraft: videoPrompt,
    videoPrompt,
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: names.requiredCharacters,
    requiredProps: names.requiredProps,
    requiredScene: names.requiredScene,
    characterAssetIds: softChars,
    sceneAssetIds: fallbackScene ? [fallbackScene] : [],
    sceneAssetId: fallbackScene,
    propAssetIds: softProps,
    audioAssetIds: matchedAssetIds(assetMatches, "audio"),
    requirements,
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    order,
    promptRegenJobId: null,
  };

  if (libraryAssets) {
    shot = autoLinkShotToLibrary(shot, libraryAssets);
  }

  return shot;
}

function buildScene(
  block: string,
  sceneNumber: number,
  order: number,
  assetMatches: AssetMatchItem[],
  libraryAssets?: MatchableAssets | null,
): StoryboardScene {
  const meta = parseSceneMeta(block);
  const shotSnippets = splitShots(block);
  const shotCount = Math.min(4, Math.max(2, shotSnippets.length));
  const snippets =
    shotSnippets.length >= shotCount
      ? shotSnippets.slice(0, shotCount)
      : [
          ...shotSnippets,
          ...Array.from(
            { length: shotCount - shotSnippets.length },
            (_, i) => `${meta.title} — 镜头 ${shotSnippets.length + i + 1}`,
          ),
        ];

  const characterAssetIds = matchedAssetIds(assetMatches, "character");
  const sceneAssetIds = matchedAssetIds(assetMatches, "scene");
  const propAssetIds = matchedAssetIds(assetMatches, "prop");

  return {
    id: `scene_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    sceneNumber,
    title: meta.title,
    location: meta.location,
    timeOfDay: meta.timeOfDay,
    interiorExterior: meta.interiorExterior,
    summary: block.slice(0, 160),
    characterAssetIds,
    sceneAssetIds,
    propAssetIds,
    order,
    shots: snippets.map((snippet, index) =>
      buildShot(snippet, index + 1, index, assetMatches, meta, libraryAssets),
    ),
    confirmed: false,
  };
}

/** DEV/mock structured storyboard generator — no external video or text APIs. */
export function generateStructuredStoryboard(
  input: GenerateStructuredStoryboardInput,
): StoryboardDocument {
  const now = new Date().toISOString();
  const blocks = clampSceneCount(splitScriptBlocks(input.scriptText));
  const sceneCount = Math.min(4, Math.max(2, blocks.length));
  const sceneBlocks =
    blocks.length >= sceneCount
      ? blocks.slice(0, sceneCount)
      : [
          ...blocks,
          ...Array.from(
            { length: sceneCount - blocks.length },
            (_, i) => `场景 ${blocks.length + i + 1}`,
          ),
        ];

  void input.userId;

  const scenes = assignContinuousEpisodeShotNumbers(
    sceneBlocks.map((block, index) =>
      buildScene(
        block,
        index + 1,
        index,
        input.assetMatches,
        input.libraryAssets,
      ),
    ),
  );

  return {
    id: `storyboard_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    version: 1,
    status: "ready",
    sourceScriptHash: input.sourceScriptHash,
    sourceAssetSnapshotHash: input.sourceAssetSnapshotHash,
    generationJobId: `mock_job_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    scenes,
    videoHistoryGenerationIds: [],
    confirmedAt: null,
    confirmedBy: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Re-generate while preserving locked / prompt-locked / manually-edited prompts。
 * 按「场次内下标」匹配，避免整集连续镜号变化后对不上。
 *
 * 保留稳定 shot.id、lastGenerationId、videoHistoryGenerationIds；
 * 本集文档级 videoHistoryGenerationIds 只增不删，结构变化后的孤儿视频仍可预览。
 */
export function mergePreserveLockedShots(
  previous: StoryboardDocument | null,
  generated: StoryboardDocument,
): StoryboardDocument {
  if (!previous) return generated;

  const previousByKey = new Map<string, StoryboardShot>();
  for (const scene of previous.scenes) {
    scene.shots.forEach((shot, index) => {
      previousByKey.set(`${scene.sceneNumber}:${index}`, shot);
    });
  }
  const previousHistory = collectPreviousVideoHistoryIds(previous);

  const mergedScenes = generated.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot, index) => {
      const key = `${scene.sceneNumber}:${index}`;
      const preserved = previousByKey.get(key);
      if (!preserved) return shot;

      const historyIds = uniqueGenerationIds(
        previousHistory.byKey.get(key) ?? [],
        preserved.videoHistoryGenerationIds,
        preserved.lastGenerationId,
        shot.videoHistoryGenerationIds,
      );

      const videoCarry = {
        id: preserved.id,
        lastGenerationId: preserved.lastGenerationId,
        lastVideoContentHash: preserved.lastVideoContentHash,
        videoHistoryGenerationIds: historyIds,
        videoContentStale: Boolean(
          preserved.lastGenerationId ||
            preserved.lastVideoContentHash ||
            historyIds.length > 0,
        )
          ? true
          : shot.videoContentStale,
      };

      if (preserved.locked || preserved.promptLocked) {
        return {
          ...preserved,
          ...videoCarry,
          order: shot.order,
          videoContentStale:
            videoCarry.videoContentStale || preserved.videoContentStale,
        };
      }

      if (preserved.manuallyEdited) {
        return {
          ...shot,
          ...videoCarry,
          shotSummary: preserved.shotSummary || shot.shotSummary,
          videoPrompt: preserved.videoPrompt || preserved.promptDraft,
          promptDraft: preserved.promptDraft || preserved.videoPrompt,
          characterAssetIds: preserved.characterAssetIds,
          propAssetIds: preserved.propAssetIds,
          sceneAssetId: preserved.sceneAssetId,
          sceneAssetIds: preserved.sceneAssetIds,
          requirements: preserved.requirements,
          manuallyEdited: true,
          promptLocked: preserved.promptLocked,
          locked: preserved.locked,
          order: shot.order,
          revision: preserved.revision + 1,
        };
      }

      return {
        ...shot,
        ...videoCarry,
        order: shot.order,
        revision: Math.max(shot.revision, preserved.revision) + 1,
      };
    }),
  }));

  const mergedShotHistory = mergedScenes.flatMap((scene) =>
    scene.shots.flatMap((s) => [
      ...s.videoHistoryGenerationIds,
      s.lastGenerationId,
    ]),
  );

  return {
    ...generated,
    id: previous.id,
    version: previous.version + 1,
    revision: previous.revision + 1,
    createdAt: previous.createdAt,
    scenes: assignContinuousEpisodeShotNumbers(mergedScenes),
    videoHistoryGenerationIds: uniqueGenerationIds(
      previousHistory.documentIds,
      generated.videoHistoryGenerationIds,
      mergedShotHistory,
    ),
  };
}
