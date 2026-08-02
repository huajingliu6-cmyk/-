import { randomUUID } from "crypto";
import { countVisibleChars } from "@/text-generation/char-count";
import { splitSourceTextIntoBlocks } from "@/projects/script/script-split-blocks";
import { episodeContentFingerprint } from "@/projects/script/script-split-reconstruct";
import { parseScriptTxtEpisodes } from "@/projects/script/script-txt-parser";
import type { ProposedEpisode } from "@/projects/script/script-split-types";

/** 无标题时按可见字数切块，避免整本落成 1 集。 */
export const LOCAL_SPLIT_TARGET_CHARS_PER_EPISODE = 6000;
export const LOCAL_SPLIT_MAX_EPISODES = 80;

export type LocalScriptSplitResult = {
  proposedEpisodes: ProposedEpisode[];
  mode: "title" | "blocks";
  warnings: string[];
};

function newProposedId(): string {
  return `pep_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function toProposed(
  episodeNumber: number,
  title: string,
  text: string,
): ProposedEpisode {
  return {
    id: newProposedId(),
    episodeNumber,
    title: title.trim() || `第${episodeNumber}集`,
    text,
    contentFingerprint: episodeContentFingerprint(text),
  };
}

/**
 * 本地分集：优先按「第N集 / EP N」标题切；无标题时按段落块均分。
 * 不调用大模型，不改写正文（仅切边界与标题）。
 */
export function buildLocalProposedEpisodes(
  sourceText: string,
): LocalScriptSplitResult {
  const normalized = sourceText.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return {
      proposedEpisodes: [],
      mode: "title",
      warnings: ["源文本为空"],
    };
  }

  const parsed = parseScriptTxtEpisodes(normalized);
  if (parsed.episodeCount >= 2) {
    const proposedEpisodes = parsed.episodes
      .filter((ep) => ep.content.trim())
      .map((ep, index) =>
        toProposed(
          index + 1,
          ep.title,
          ep.content,
        ),
      );
    // 保留原文集号外观在标题里，但 review/confirm 要求顺序集号时用 1..n
    const renumbered = proposedEpisodes.map((ep, i) => ({
      ...ep,
      episodeNumber: i + 1,
    }));
    return {
      proposedEpisodes: renumbered,
      mode: "title",
      warnings: parsed.warnings,
    };
  }

  // 仅 1 条标题命中：仍用标题解析结果（含整本无标题时的单集）
  if (parsed.episodeCount === 1 && parsed.episodes[0]) {
    const only = parsed.episodes[0];
    // 无标题单集且正文很长 → 改走块切分
    const hasTitleMarker = /^(?:第\s*\S+\s*[集回]|EP(?:ISODE)?\s*\d+)/im.test(
      normalized,
    );
    if (
      hasTitleMarker ||
      countVisibleChars(only.content) <= LOCAL_SPLIT_TARGET_CHARS_PER_EPISODE
    ) {
      return {
        proposedEpisodes: [
          toProposed(1, only.title, only.content),
        ],
        mode: "title",
        warnings: parsed.warnings,
      };
    }
  }

  return {
    ...splitByBlocks(normalized),
    warnings: [
      ...parsed.warnings,
      "未检测到多集标题，已按段落块本地均分。",
    ],
  };
}

function splitByBlocks(sourceText: string): Omit<LocalScriptSplitResult, "warnings"> & {
  warnings?: string[];
} {
  const blocks = splitSourceTextIntoBlocks(sourceText);
  if (blocks.length === 0) {
    return { proposedEpisodes: [], mode: "blocks" };
  }

  const totalChars = blocks.reduce(
    (sum, b) => sum + countVisibleChars(b.text),
    0,
  );
  const targetEpisodes = Math.min(
    LOCAL_SPLIT_MAX_EPISODES,
    Math.max(1, Math.ceil(totalChars / LOCAL_SPLIT_TARGET_CHARS_PER_EPISODE)),
  );
  const blocksPerEpisode = Math.max(
    1,
    Math.ceil(blocks.length / targetEpisodes),
  );

  const proposedEpisodes: ProposedEpisode[] = [];
  for (let i = 0; i < blocks.length; i += blocksPerEpisode) {
    const slice = blocks.slice(i, i + blocksPerEpisode);
    const text = slice.map((b) => b.text).join("\n\n");
    if (!text.trim()) continue;
    const episodeNumber = proposedEpisodes.length + 1;
    proposedEpisodes.push(toProposed(episodeNumber, `第${episodeNumber}集`, text));
  }

  return { proposedEpisodes, mode: "blocks" };
}
