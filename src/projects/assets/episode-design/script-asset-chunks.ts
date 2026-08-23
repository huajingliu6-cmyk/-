import { countVisibleChars } from "@/text-generation/char-count";

export const SCRIPT_ASSET_CHUNK_TARGET_CHARS = 25_000;
export const SCRIPT_ASSET_CHUNK_MAX_CHARS = 30_000;
export const SCRIPT_ASSET_CHUNK_MIN_CHARS = 8_000;
export const SCRIPT_ASSET_MAP_CONCURRENCY = 2;

export type ScriptAssetChunk = {
  chunkId: string;
  label: string;
  /** Provider brief for this chunk only. */
  brief: string;
  /** Raw script text in this chunk (without extract-task wrapping). */
  body?: string;
  visibleChars: number;
  episodeIds?: string[];
};

export type ScriptEpisodeLike = {
  id: string;
  episodeNumber: number;
  title: string;
  content: string;
};

function wrapChunkBrief(label: string, body: string): string {
  return [
    "任务：从以下剧本分块中提取影视资产（角色/场景/道具/音频）。",
    "这是全剧本 Map 分块之一；只分析本分块正文，不要臆造未出现的资产。",
    `分块标签：${label}`,
    "<剧本分块>",
    body,
    "</剧本分块>",
  ].join("\n");
}

function splitByParagraphBudget(
  sourceText: string,
  targetChars: number,
): string[] {
  const normalized = sourceText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (countVisibleChars(normalized) <= SCRIPT_ASSET_CHUNK_MAX_CHARS) {
    return [normalized];
  }

  const sceneSplit = normalized.split(/(?=\n\s*(?:场景|第.+场|INT\.|EXT\.|内景|外景)[^\n]{0,40}\n)/i);
  const blocks =
    sceneSplit.length > 1
      ? sceneSplit.map((s) => s.trim()).filter(Boolean)
      : normalized.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

  const chunks: string[] = [];
  let buf = "";
  for (const block of blocks) {
    const next = buf ? `${buf}\n\n${block}` : block;
    if (
      buf &&
      countVisibleChars(next) > targetChars &&
      countVisibleChars(buf) >= SCRIPT_ASSET_CHUNK_MIN_CHARS
    ) {
      chunks.push(buf);
      buf = block;
    } else if (countVisibleChars(next) > SCRIPT_ASSET_CHUNK_MAX_CHARS && buf) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  // Hard split oversized leftovers.
  const hard: string[] = [];
  for (const chunk of chunks) {
    if (countVisibleChars(chunk) <= SCRIPT_ASSET_CHUNK_MAX_CHARS) {
      hard.push(chunk);
      continue;
    }
    let rest = chunk;
    while (countVisibleChars(rest) > SCRIPT_ASSET_CHUNK_MAX_CHARS) {
      // Approximate cut by code units near budget.
      let cut = Math.min(rest.length, SCRIPT_ASSET_CHUNK_MAX_CHARS);
      const window = rest.slice(0, cut);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf("。"),
      );
      if (breakAt > SCRIPT_ASSET_CHUNK_MIN_CHARS) cut = breakAt + 1;
      hard.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) hard.push(rest);
  }
  return hard.filter(Boolean);
}

/**
 * Prefer formal episodes; otherwise split source by scene/paragraph boundaries.
 */
export function buildScriptAssetChunks(input: {
  sourceText: string;
  episodes?: ScriptEpisodeLike[];
}): ScriptAssetChunk[] {
  const episodes = (input.episodes ?? [])
    .map((e) => ({
      ...e,
      content: e.content.replace(/\r\n/g, "\n").trim(),
    }))
    .filter((e) => e.content.length > 0)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  if (episodes.length > 0) {
    const chunks: ScriptAssetChunk[] = [];
    let buf: ScriptEpisodeLike[] = [];
    let bufChars = 0;

    const flush = () => {
      if (buf.length === 0) return;
      const label =
        buf.length === 1
          ? `第${buf[0]!.episodeNumber}集 ${buf[0]!.title}`.trim()
          : `第${buf[0]!.episodeNumber}–${buf[buf.length - 1]!.episodeNumber}集`;
      const body = buf
        .map(
          (e) =>
            `【第${e.episodeNumber}集｜${e.title}】\n${e.content}`,
        )
        .join("\n\n");
      chunks.push({
        chunkId: `eps_${buf[0]!.episodeNumber}_${buf[buf.length - 1]!.episodeNumber}`,
        label,
        brief: wrapChunkBrief(label, body),
        body,
        visibleChars: countVisibleChars(body),
        episodeIds: buf.map((e) => e.id),
      });
      buf = [];
      bufChars = 0;
    };

    for (const ep of episodes) {
      const chars = countVisibleChars(ep.content);
      if (
        buf.length > 0 &&
        bufChars + chars > SCRIPT_ASSET_CHUNK_TARGET_CHARS &&
        bufChars >= SCRIPT_ASSET_CHUNK_MIN_CHARS
      ) {
        flush();
      }
      if (chars > SCRIPT_ASSET_CHUNK_MAX_CHARS) {
        flush();
        const parts = splitByParagraphBudget(ep.content, SCRIPT_ASSET_CHUNK_TARGET_CHARS);
        parts.forEach((part, idx) => {
          const label = `第${ep.episodeNumber}集 ${ep.title} · 分段${idx + 1}`.trim();
          chunks.push({
            chunkId: `ep_${ep.episodeNumber}_p${idx + 1}`,
            label,
            brief: wrapChunkBrief(label, part),
            body: part,
            visibleChars: countVisibleChars(part),
            episodeIds: [ep.id],
          });
        });
        continue;
      }
      buf.push(ep);
      bufChars += chars;
    }
    flush();
    return chunks;
  }

  const sourceText = input.sourceText.replace(/\r\n/g, "\n").trim();
  const parts = splitByParagraphBudget(
    sourceText,
    SCRIPT_ASSET_CHUNK_TARGET_CHARS,
  );
  if (parts.length <= 1) {
    const body = parts[0] ?? sourceText;
    return [
      {
        chunkId: "full_1",
        label: "未分集完整剧本",
        brief: [
          "任务：从以下未分集完整剧本中提取全剧本资产。",
          "<完整剧本>",
          body,
          "</完整剧本>",
        ].join("\n"),
        body,
        visibleChars: countVisibleChars(body),
      },
    ];
  }
  return parts.map((part, idx) => {
    const label = `未分集剧本 · 分段${idx + 1}/${parts.length}`;
    return {
      chunkId: `src_${idx + 1}`,
      label,
      brief: wrapChunkBrief(label, part),
      body: part,
      visibleChars: countVisibleChars(part),
    };
  });
}
