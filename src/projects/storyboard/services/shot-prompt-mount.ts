/**
 * 一键替换素材：同步「挂载」行，并把正文中的资产名换成可渲染的图片标记。
 * 标记格式：【图:assetId:显示名】——编辑区可见，预览区渲染为缩略图。
 */

export type MountableAsset = {
  id: string;
  kind: "character" | "scene" | "prop";
  name: string;
  /** 有参考图时才写成图片标记；否则退回「图N（名）」纯文本 */
  imageUrl?: string | null;
  /** 仅人物：紧跟人物挂载项显示的对应音色。 */
  voiceLabel?: string | null;
};

const KIND_LABEL: Record<MountableAsset["kind"], string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

const MOUNT_LINE_RE = /^挂载[：:].*$/m;
/** `@人物-名` / `@人物【图】-名` 挂载标签 */
const AT_MOUNT_TAG_RE =
  /@(?:人物|场景|道具|音频|音色)(?:【图:[^】\n]+】)?-[^\s｜|，,。；;：:\n]+/g;
/** 图片替换标记 */
export const IMAGE_MOUNT_TOKEN_RE = /【图:([^:】\n]+):([^】\n]+)】/g;

export function promptHasImageMountTokens(prompt: string): boolean {
  return /【图:[^:】\n]+:[^】\n]+】/.test(prompt);
}
/** 纯文本图号：图1（江宸） */
const FIGURE_REF_RE = /图\d+（[^）\n]+）/g;

export function mountTagFor(asset: Pick<MountableAsset, "kind" | "name">): string | null {
  const name = asset.name.trim();
  if (!name) return null;
  return `@${KIND_LABEL[asset.kind]}-${name}`;
}

export function imageTokenFor(asset: MountableAsset): string | null {
  const name = asset.name.trim();
  const id = asset.id.trim();
  if (!name || !id) return null;
  if (asset.imageUrl?.trim()) {
    return `【图:${id}:${name}】`;
  }
  return null;
}

/**
 * 挂载条目正确格式：
 * - 有图：`@人物【图:id:名】-江宸` / `@场景【图:id:名】-办公室`
 * - 无图：`@人物-江宸` / `@场景-办公室`
 */
export function mountEntryFor(asset: MountableAsset): string | null {
  const name = asset.name.trim();
  if (!name) return null;
  const kind = KIND_LABEL[asset.kind];
  const imageToken = imageTokenFor(asset);
  const voiceEntry =
    asset.kind === "character" && asset.voiceLabel?.trim()
      ? `｜@音色-${asset.voiceLabel.trim()}`
      : "";
  if (imageToken) {
    return `@${kind}${imageToken}-${name}${voiceEntry}`;
  }
  return `@${kind}-${name}${voiceEntry}`;
}

/** 挂载行顺序：人物 → 场景 → 道具（任务规则） */
export function orderMountAssets(assets: MountableAsset[]): MountableAsset[] {
  const rank = { character: 0, scene: 1, prop: 2 } as const;
  return dedupeAssets(assets).sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** 视频参考图顺序：人物 → 道具 → 场景（与 submit 一致） */
export function orderAssetsForVideoRefs(assets: MountableAsset[]): MountableAsset[] {
  const rank = { character: 0, prop: 1, scene: 2 } as const;
  return dedupeAssets(assets).sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function dedupeAssets(assets: MountableAsset[]): MountableAsset[] {
  const cleaned = assets
    .map((a) => ({
      ...a,
      id: a.id.trim(),
      name: a.name.trim(),
      imageUrl: a.imageUrl?.trim() || null,
    }))
    .filter((a) => a.name.length > 0 && a.id.length > 0);
  const seen = new Set<string>();
  const unique: MountableAsset[] = [];
  for (const a of cleaned) {
    const key = `${a.kind}:${a.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }
  return unique;
}

/** 挂载行：`@人物【图】-名｜@场景【图】-名`（无图则 `@人物-名`） */
export function buildMountLine(assets: MountableAsset[]): string | null {
  const tags = orderMountAssets(assets)
    .map((a) => mountEntryFor(a))
    .filter((t): t is string => Boolean(t));
  if (tags.length === 0) return null;
  return `挂载：${tags.join("｜")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectSpans(text: string, patterns: RegExp[]): {
  masked: string;
  spans: string[];
} {
  const spans: string[] = [];
  let masked = text;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    masked = masked.replace(re, (match) => {
      const idx = spans.length;
      spans.push(match);
      return `\u0000SPAN${idx}\u0000`;
    });
  }
  return { masked, spans };
}

function restoreSpans(text: string, spans: string[]): string {
  return text.replace(/\u0000SPAN(\d+)\u0000/g, (_, i) => spans[Number(i)] ?? "");
}

/**
 * 正文：裸名 → 【图:id:名】（有图）或 图N（名）；
 * `@人物-名` → `@人物【图:id:名】-名`（有图时）。
 */
export function replaceAssetNamesWithImageTokens(
  text: string,
  assets: MountableAsset[],
): { text: string; figureLabels: Array<{ index: number; name: string; id: string }> } {
  const ordered = orderMountAssets(assets)
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  if (ordered.length === 0) {
    return { text, figureLabels: [] };
  }

  // 编号按视频参考图顺序（人物→道具→场景）
  const numbered = orderAssetsForVideoRefs(assets);
  const figureIndexById = new Map<string, number>();
  numbered.forEach((a, i) => figureIndexById.set(a.id, i + 1));

  let next = text;

  // 1) 旧挂载标签 → @人物【图】-名
  for (const asset of ordered) {
    const atTag = mountTagFor(asset);
    const atEntry = mountEntryFor(asset);
    if (!atTag || !atEntry) continue;
    if (atTag !== atEntry) {
      next = next.split(atTag).join(atEntry);
    }
  }

  // 2) 保护挂载条目 / 图片标记 / 图N，避免裸名替换拆开
  const spans: string[] = [];
  const stash = (match: string) => {
    const idx = spans.length;
    spans.push(match);
    return `\u0000SPAN${idx}\u0000`;
  };
  const mountEntries = ordered
    .map((a) => mountEntryFor(a))
    .filter((t): t is string => t !== null && t.includes("【图:"))
    .sort((a, b) => b.length - a.length);
  for (const entry of mountEntries) {
    if (!next.includes(entry)) continue;
    next = next.split(entry).join(stash(entry));
  }
  next = next.replace(new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g"), (m) =>
    stash(m),
  );
  next = next.replace(new RegExp(FIGURE_REF_RE.source, "g"), (m) => stash(m));

  // 3) 正文裸名 → 图片标记
  for (const asset of ordered) {
    const imageToken = imageTokenFor(asset);
    const figureIdx = figureIndexById.get(asset.id) ?? 0;
    const fallback = `图${figureIdx}（${asset.name}）`;
    const bareReplacement = imageToken ?? fallback;
    const re = new RegExp(escapeRegExp(asset.name), "g");
    next = next.replace(re, bareReplacement);
  }

  return {
    text: restoreSpans(next, spans),
    figureLabels: numbered.map((a, i) => ({
      index: i + 1,
      name: a.name,
      id: a.id,
    })),
  };
}

export function upsertMountLine(prompt: string, mountLine: string): string {
  const trimmedMount = mountLine.trim();
  if (!trimmedMount) return prompt;

  if (MOUNT_LINE_RE.test(prompt)) {
    return prompt.replace(MOUNT_LINE_RE, trimmedMount);
  }

  const lines = prompt.split(/\r?\n/);
  if (lines.length === 0) return trimmedMount;

  const headerIdx = lines.findIndex((line) =>
    /^\s*\[分镜\d+/u.test(line.trim()),
  );
  if (headerIdx >= 0) {
    lines.splice(headerIdx + 1, 0, trimmedMount);
    return lines.join("\n");
  }

  if (prompt.trim() === "") return trimmedMount;
  return `${trimmedMount}\n${prompt}`;
}

export type ApplyShotPromptAssetMountResult = {
  prompt: string;
  changed: boolean;
  mountLine: string | null;
  replacedNames: string[];
};

/**
 * 1) 正文裸名 → 【图:id:名】；`@人物-名` → `@人物【图】-名`
 * 2) 写入/更新挂载行：`@人物【图】-名｜@场景【图】-名`
 */
export function applyShotPromptAssetMount(
  prompt: string,
  assets: MountableAsset[],
): ApplyShotPromptAssetMountResult {
  const ordered = orderMountAssets(assets);
  const mountLine = buildMountLine(ordered);
  if (!mountLine) {
    return {
      prompt,
      changed: false,
      mountLine: null,
      replacedNames: [],
    };
  }

  // 先摘掉旧挂载行，避免正文替换时把挂载区改乱，再统一写入新挂载行
  const withoutMount = prompt.replace(MOUNT_LINE_RE, "").replace(/\n{3,}/g, "\n\n");
  const { text: withImages } = replaceAssetNamesWithImageTokens(
    withoutMount,
    ordered,
  );
  const next = upsertMountLine(withImages, mountLine);

  const replacedNames = ordered
    .map((a) => a.name)
    .filter((name) => {
      const before = countLooseName(prompt, name);
      const after = countLooseName(next, name);
      return before > after;
    });

  return {
    prompt: next,
    changed: next !== prompt,
    mountLine,
    replacedNames,
  };
}

function countLooseName(text: string, name: string): number {
  // 先保护完整 `@人物【图】-名`，再保护裸【图】/图N，避免拆开挂载条目
  const { masked } = protectSpans(text, [
    AT_MOUNT_TAG_RE,
    IMAGE_MOUNT_TOKEN_RE,
    FIGURE_REF_RE,
  ]);
  const re = new RegExp(escapeRegExp(name), "g");
  return (masked.match(re) ?? []).length;
}

export type PromptImageSegment =
  | { type: "text"; value: string }
  | { type: "image"; assetId: string; name: string };

/** 把提示词拆成文本 + 图片标记，供预览渲染 */
export function parsePromptImageSegments(prompt: string): PromptImageSegment[] {
  const segments: PromptImageSegment[] = [];
  const re = new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", value: prompt.slice(last, match.index) });
    }
    segments.push({
      type: "image",
      assetId: match[1]!,
      name: match[2]!,
    });
    last = match.index + match[0].length;
  }
  if (last < prompt.length) {
    segments.push({ type: "text", value: prompt.slice(last) });
  }
  return segments;
}

/**
 * 提交视频前：把【图:id:名】与 图N（名）规范成「图N（名）」，
 * 编号与 reference 素材顺序一致（人物→场景→道具）。
 */
export function normalizePromptImageTokensForSubmit(
  prompt: string,
  orderedAssetIds: string[],
  nameById: Map<string, string>,
): string {
  const indexById = new Map<string, number>();
  orderedAssetIds.forEach((id, i) => indexById.set(id, i + 1));

  return prompt.replace(IMAGE_MOUNT_TOKEN_RE, (_full, assetId: string, name: string) => {
    const idx = indexById.get(assetId);
    const label = nameById.get(assetId) ?? name;
    if (idx != null) return `图${idx}（${label}）`;
    return `图（${label}）`;
  });
}
