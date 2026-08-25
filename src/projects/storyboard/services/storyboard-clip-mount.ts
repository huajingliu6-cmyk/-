import type { CharacterAsset, PropAsset, SceneAsset } from "@/projects/assets/types";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import type { StoryboardClipValidationIssue } from "@/projects/storyboard/services/storyboard-clip-types";
import {
  buildMountLine,
  type MountableAsset,
} from "@/projects/storyboard/services/shot-prompt-mount";
import type { StoryboardShot } from "@/projects/storyboard/types";

export function shotHasCharacters(shot: StoryboardShot): boolean {
  return (
    (shot.requiredCharacters?.some((name) => name.trim()) ?? false) ||
    (shot.characterAssetIds?.length ?? 0) > 0 ||
    Boolean(shot.dialogue?.trim())
  );
}

/** Binding gate: dialogue-only shots do not require character asset ids. */
export function shotRequiresCharacterAssetBinding(shot: StoryboardShot): boolean {
  return (
    (shot.requiredCharacters?.some((name) => name.trim()) ?? false) ||
    (shot.characterAssetIds?.length ?? 0) > 0
  );
}

function characterHasUsableMedia(
  character: CharacterAsset,
  selectedMediaId?: string | null,
): boolean {
  if (selectedMediaId?.trim()) return true;
  if (character.primaryMediaId?.trim()) return true;
  if (character.approvedMediaIds?.some((id) => id.trim())) return true;
  if (character.imageFileName?.trim()) return true;
  if (character.imageObjectUrl?.trim()) return true;
  return false;
}

function sceneHasUsableMedia(
  scene: SceneAsset,
  selectedMediaId?: string | null,
): boolean {
  if (selectedMediaId?.trim()) return true;
  if (scene.primaryMediaId?.trim()) return true;
  if (scene.approvedMediaIds?.some((id) => id.trim())) return true;
  if (scene.imageFileName?.trim()) return true;
  if (scene.imageObjectUrl?.trim()) return true;
  return false;
}

function propHasUsableMedia(
  prop: PropAsset,
  selectedMediaId?: string | null,
): boolean {
  if (selectedMediaId?.trim()) return true;
  if (prop.primaryMediaId?.trim()) return true;
  if (prop.approvedMediaIds?.some((id) => id.trim())) return true;
  if (prop.imageFileName?.trim()) return true;
  if (prop.imageObjectUrl?.trim()) return true;
  return false;
}

function resolveMediaMarker(
  selectedMediaId: string | null | undefined,
  primaryMediaId: string | null | undefined,
  approvedMediaIds: string[] | undefined,
  imageFileName: string | null | undefined,
  imageObjectUrl: string | null | undefined,
): string | null {
  const selected = selectedMediaId?.trim();
  if (selected) return selected;
  const primary = primaryMediaId?.trim();
  if (primary) return primary;
  const approved = approvedMediaIds?.find((id) => id.trim())?.trim();
  if (approved) return approved;
  if (imageFileName?.trim() || imageObjectUrl?.trim()) return "legacy";
  return null;
}

/** Validate that shot character bindings exist in the project library with usable media.
 * Returns warnings only — never blocks prompt generation.
 */
export function validateShotCharacterAssetBindings(input: {
  shot: StoryboardShot;
  libraryAssets?: MatchableAssets | null;
}): StoryboardClipValidationIssue[] {
  const issues: StoryboardClipValidationIssue[] = [];
  const base = { shotId: input.shot.id, shotNumber: input.shot.shotNumber };
  if (!shotRequiresCharacterAssetBinding(input.shot)) return issues;

  const requiredNames = (input.shot.requiredCharacters ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  const assetIds = input.shot.characterAssetIds ?? [];

  if (assetIds.length === 0) {
    const names = requiredNames.join("、");
    issues.push({
      ...base,
      code: "CHARACTER_BINDING_INCOMPLETE",
      message: names
        ? `人物「${names}」暂无可用参考图，已使用文字描述生成提示词`
        : "本镜人物需求未完成绑定，将使用文字描述生成",
    });
    return issues;
  }

  const byId = new Map(
    (input.libraryAssets?.characters ?? []).map((c) => [c.id, c]),
  );

  for (const assetId of assetIds) {
    const character = byId.get(assetId);
    if (!character) {
      const nameHint = requiredNames[0] ? `「${requiredNames.join("、")}」` : "";
      issues.push({
        ...base,
        code: "CHARACTER_ASSET_NOT_FOUND",
        message: nameHint
          ? `人物${nameHint}暂无可用参考图，已使用文字描述生成提示词`
          : "本镜人物资产未找到，已使用文字描述生成提示词",
      });
      continue;
    }
    const selected = input.shot.assetMediaIds?.[assetId] ?? null;
    if (!characterHasUsableMedia(character, selected)) {
      issues.push({
        ...base,
        code: "CHARACTER_ASSET_NO_MEDIA",
        message: `人物资产「${character.name}」暂无可用参考图，当前提示词未挂载图片`,
      });
    }
  }

  return issues;
}

/**
 * Build canonical mount line from shot bindings + project library.
 * Ignores any model-provided mountLine / forged asset ids.
 */
export function buildCanonicalMountLine(input: {
  shot: StoryboardShot;
  libraryAssets?: MatchableAssets | null;
}): string | null {
  const assets: MountableAsset[] = [];
  const library = input.libraryAssets;
  const mediaByAsset = input.shot.assetMediaIds ?? {};

  for (const assetId of input.shot.characterAssetIds ?? []) {
    const character = library?.characters.find((c) => c.id === assetId);
    if (!character) continue;
    const selected = mediaByAsset[assetId] ?? null;
    if (!characterHasUsableMedia(character, selected)) continue;
    const mediaMarker = resolveMediaMarker(
      selected,
      character.primaryMediaId,
      character.approvedMediaIds,
      character.imageFileName,
      character.imageObjectUrl,
    );
    assets.push({
      id: character.id,
      kind: "character",
      name: character.name,
      imageUrl: mediaMarker,
      voiceLabel: character.voiceName,
    });
  }

  const sceneId = input.shot.sceneAssetId;
  if (sceneId) {
    const scene = library?.scenes.find((s) => s.id === sceneId);
    if (scene) {
      const selected = mediaByAsset[sceneId] ?? null;
      if (sceneHasUsableMedia(scene, selected)) {
        const mediaMarker = resolveMediaMarker(
          selected,
          scene.primaryMediaId,
          scene.approvedMediaIds,
          scene.imageFileName,
          scene.imageObjectUrl,
        );
        assets.push({
          id: scene.id,
          kind: "scene",
          name: scene.name,
          imageUrl: mediaMarker,
        });
      }
    }
  }

  for (const assetId of input.shot.propAssetIds ?? []) {
    const prop = library?.props.find((p) => p.id === assetId);
    if (!prop) continue;
    const selected = mediaByAsset[assetId] ?? null;
    if (!propHasUsableMedia(prop, selected)) continue;
    const mediaMarker = resolveMediaMarker(
      selected,
      prop.primaryMediaId,
      prop.approvedMediaIds,
      prop.imageFileName,
      prop.imageObjectUrl,
    );
    assets.push({
      id: prop.id,
      kind: "prop",
      name: prop.name,
      imageUrl: mediaMarker,
    });
  }

  return buildMountLine(assets);
}

/** True when prompt contains a bare `assetId:` / `assetId=` field (not 【图:id:名】). */
export function promptHasBareAssetIdField(prompt: string): boolean {
  return /(?:^|[\s｜|,，])assetId\s*[:=]/i.test(prompt);
}
