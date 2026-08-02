import { createHash } from "crypto";
import {
  parseBlockIdIndex,
  type ScriptTextBlock,
} from "@/projects/script/script-split-blocks";
import type { ScriptSplitModelOutput } from "@/projects/script/script-split-schema";
import type { ProposedEpisode } from "@/projects/script/script-split-types";

export function episodeContentFingerprint(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type ReconstructEpisodesResult =
  | { ok: true; episodes: ProposedEpisode[] }
  | {
      ok: false;
      code:
        | "SCRIPT_SPLIT_UNKNOWN_BLOCK"
        | "SCRIPT_SPLIT_OVERLAP"
        | "SCRIPT_SPLIT_GAP"
        | "SCRIPT_SPLIT_HEAD_UNCOVERED"
        | "SCRIPT_SPLIT_TAIL_UNCOVERED"
        | "SCRIPT_SPLIT_DUPLICATE_EPISODE"
        | "SCRIPT_SPLIT_NON_SEQUENTIAL"
        | "SCRIPT_SPLIT_EMPTY_EPISODE"
        | "SCRIPT_SPLIT_NO_BLOCKS";
      message: string;
    };

function blockIndexMap(
  blocks: readonly ScriptTextBlock[],
): Map<string, number> {
  const map = new Map<string, number>();
  blocks.forEach((b, i) => map.set(b.id, i));
  return map;
}

export function reconstructEpisodesFromBoundaries(
  blocks: readonly ScriptTextBlock[],
  boundaries: ScriptSplitModelOutput,
): ReconstructEpisodesResult {
  if (blocks.length === 0) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_NO_BLOCKS",
      message: "源文本无有效块",
    };
  }

  const idToIndex = blockIndexMap(blocks);
  const sorted = [...boundaries.episodes].sort(
    (a, b) => a.episodeNumber - b.episodeNumber,
  );

  for (let i = 0; i < sorted.length; i += 1) {
    const expected = i + 1;
    if (sorted[i]!.episodeNumber !== expected) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_NON_SEQUENTIAL",
        message: `集号必须从 1 起连续递增，期望 ${expected}，实际 ${sorted[i]!.episodeNumber}`,
      };
    }
  }

  const seenNumbers = new Set<number>();
  for (const ep of sorted) {
    if (seenNumbers.has(ep.episodeNumber)) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_DUPLICATE_EPISODE",
        message: `集号 ${ep.episodeNumber} 重复`,
      };
    }
    seenNumbers.add(ep.episodeNumber);
  }

  const covered = new Array<boolean>(blocks.length).fill(false);
  const episodes: ProposedEpisode[] = [];

  for (const boundary of sorted) {
    const startIdx = idToIndex.get(boundary.startBlockId);
    const endIdx = idToIndex.get(boundary.endBlockId);
    if (startIdx === undefined || endIdx === undefined) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_UNKNOWN_BLOCK",
        message: `未知块 ID：${boundary.startBlockId} 或 ${boundary.endBlockId}`,
      };
    }
    if (startIdx > endIdx) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_EMPTY_EPISODE",
        message: `第 ${boundary.episodeNumber} 集起始块不能晚于结束块`,
      };
    }

    for (let i = startIdx; i <= endIdx; i += 1) {
      if (covered[i]) {
        return {
          ok: false,
          code: "SCRIPT_SPLIT_OVERLAP",
          message: `第 ${boundary.episodeNumber} 集与其他集块范围重叠`,
        };
      }
      covered[i] = true;
    }

    const slice = blocks.slice(startIdx, endIdx + 1);
    if (slice.length === 0) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_EMPTY_EPISODE",
        message: `第 ${boundary.episodeNumber} 集至少包含 1 个块`,
      };
    }

    const text = slice.map((b) => b.text).join("\n\n");
    episodes.push({
      id: `ep_split_${boundary.episodeNumber}`,
      episodeNumber: boundary.episodeNumber,
      title: boundary.title,
      text,
      contentFingerprint: episodeContentFingerprint(text),
    });
  }

  if (!covered[0]) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_HEAD_UNCOVERED",
      message: "第一块未被任何集覆盖",
    };
  }
  if (!covered[blocks.length - 1]) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_TAIL_UNCOVERED",
      message: "最后一块未被任何集覆盖",
    };
  }
  for (let i = 0; i < covered.length; i += 1) {
    if (!covered[i]) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_GAP",
        message: `块 ${blocks[i]!.id} 未被任何集覆盖`,
      };
    }
  }

  return { ok: true, episodes };
}

/** Validate block ID ordering helper for tests. */
export function isContiguousBlockRange(
  startBlockId: string,
  endBlockId: string,
): boolean {
  const start = parseBlockIdIndex(startBlockId);
  const end = parseBlockIdIndex(endBlockId);
  if (start === null || end === null) return false;
  return start <= end;
}
