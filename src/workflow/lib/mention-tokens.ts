import type { AssetRecord } from "@/workflow/types";

/** 文本中的素材提及：@[显示名](asset:id) */
export const MENTION_TOKEN_RE =
  /@\[([^\]]*)\]\(asset:([a-zA-Z0-9_-]+)\)/g;

export function buildMentionToken(asset: Pick<AssetRecord, "id" | "name">) {
  const safeName = (asset.name || "素材").replace(/[\[\]]/g, "");
  return `@[${safeName}](asset:${asset.id})`;
}

export function parseMentionAssetIds(text: string): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[2];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function filterAssetsByQuery(
  assets: AssetRecord[],
  query: string,
  limit = 24,
): AssetRecord[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? assets.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.originalFileName.toLowerCase().includes(q) ||
          a.assetType.toLowerCase().includes(q),
      )
    : [...assets];

  return list
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, limit);
}

/**
 * 在光标处用素材提及替换当前 `@query` 片段。
 * 返回新文本与新光标位置。
 */
export function insertMentionAtCaret(
  value: string,
  caret: number,
  asset: Pick<AssetRecord, "id" | "name">,
): { next: string; caret: number } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // @ 前应为行首或空白，避免邮箱等误触发后的插入
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;

  const token = buildMentionToken(asset);
  const next = value.slice(0, at) + token + value.slice(caret);
  return { next, caret: at + token.length };
}

/** 检测是否处于可弹出素材选择的 @ 状态 */
export function getActiveMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "") && before[at - 1] !== undefined) {
    // 允许行首；非空白前缀则忽略（如 email）
    const prev = before[at - 1];
    if (prev && !/[\s\n([{"'`]/.test(prev)) return null;
  }
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  // 已完成的 token 内部不触发
  if (query.includes("](asset:")) return null;
  return { start: at, query };
}
