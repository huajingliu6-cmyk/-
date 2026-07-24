/** 每个节点保留的最近生成条数 */
export const GENERATION_HISTORY_LIMIT = 24;

/** 将新生成素材插到历史最前，去重并截断。 */
export function prependGenerationHistory(
  historyIds: string[] | undefined,
  assetId: string,
  limit = GENERATION_HISTORY_LIMIT,
): string[] {
  const id = assetId.trim();
  if (!id) return [...(historyIds ?? [])];
  const next = [id, ...(historyIds ?? []).filter((x) => x && x !== id)];
  return next.slice(0, limit);
}

/** 从已有主结果种子历史（迁移 / 兼容旧文档）。 */
export function seedGenerationHistory(
  existing: unknown,
  ...seedIds: Array<string | undefined | null>
): string[] {
  if (Array.isArray(existing)) {
    const ids = existing
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    if (ids.length > 0) return ids.slice(0, GENERATION_HISTORY_LIMIT);
  }
  const seeded: string[] = [];
  for (const id of seedIds) {
    const trimmed = (id ?? "").trim();
    if (trimmed && !seeded.includes(trimmed)) seeded.push(trimmed);
  }
  return seeded.slice(0, GENERATION_HISTORY_LIMIT);
}
