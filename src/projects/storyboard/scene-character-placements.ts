import type { SceneCharacterPlacement } from "@/projects/storyboard/types";

export const MAX_SCENE_CHARACTER_PLACEMENTS = 50;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function parseSceneCharacterPlacements(
  value: unknown,
  characterAssetIds: string[],
): SceneCharacterPlacement[] | null {
  if (value === undefined) return null;
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_SCENE_CHARACTER_PLACEMENTS) return null;

  const allowed = new Set(characterAssetIds);
  const rows: SceneCharacterPlacement[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const characterAssetId =
      typeof row.characterAssetId === "string" ? row.characterAssetId.trim() : "";
    if (!characterAssetId || !allowed.has(characterAssetId)) return null;
    if (!isFiniteNumber(row.x) || !isFiniteNumber(row.y)) return null;
    const x = clamp01(row.x);
    const y = clamp01(row.y);
    const next: SceneCharacterPlacement = { characterAssetId, x, y };
    if (isFiniteNumber(row.scale)) {
      next.scale = Math.min(4, Math.max(0.05, row.scale));
    }
    if (isFiniteNumber(row.depth)) {
      next.depth = Math.min(100, Math.max(0, row.depth));
    }
    rows.push(next);
  }
  return rows;
}

export function pruneSceneCharacterPlacements(
  placements: SceneCharacterPlacement[] | undefined,
  characterAssetIds: string[],
): SceneCharacterPlacement[] | undefined {
  if (!placements?.length) return undefined;
  const allowed = new Set(characterAssetIds);
  const next = placements.filter((p) => allowed.has(p.characterAssetId));
  return next.length > 0 ? next : undefined;
}

function regionLabel(x: number, y: number): string {
  const horizontal = x < 0.33 ? "左侧" : x > 0.66 ? "右侧" : "中部";
  const vertical = y < 0.33 ? "上方" : y > 0.66 ? "下方" : "中间";
  if (horizontal === "中部" && vertical === "中间") return "画面中央";
  if (horizontal === "中部") return `画面${vertical}`;
  if (vertical === "中间") return `画面${horizontal}`;
  return `画面${horizontal}${vertical.replace("方", "")}区域`;
}

export function buildSceneCharacterPlacementPrompt(
  placements: SceneCharacterPlacement[],
  characters: Array<{ id: string; name: string }>,
): string {
  if (placements.length === 0) return "";
  const nameById = new Map(characters.map((c) => [c.id, c.name]));
  const sorted = [...placements].sort(
    (a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.x - b.x,
  );
  const lines = sorted.map((placement, index) => {
    const name = nameById.get(placement.characterAssetId) ?? placement.characterAssetId;
    const region = regionLabel(placement.x, placement.y);
    const depthNote =
      index > 0
        ? `，并位于${nameById.get(sorted[index - 1]!.characterAssetId) ?? "前一角色"}后方`
        : "";
    return `- 角色“${name}”位于${region}，归一化坐标 x=${placement.x.toFixed(2)}、y=${placement.y.toFixed(2)}${depthNote}`;
  });
  return [
    "角色位置约束：",
    ...lines,
    "- 保持人物与场景透视、比例、遮挡关系正确。",
  ].join("\n");
}

export function placementsFingerprintPayload(
  placements: SceneCharacterPlacement[] | undefined,
): string {
  if (!placements?.length) return "";
  return [...placements]
    .map(
      (p) =>
        `${p.characterAssetId}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.scale ?? ""},${p.depth ?? ""}`,
    )
    .sort()
    .join("|");
}
