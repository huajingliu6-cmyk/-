/**
 * Build canonical script sourceText from episodes.
 * Stable across IDs / timestamps / import metadata.
 */

import type { ScriptEpisode } from "@/projects/script/types";
import { parseScriptTxtEpisodes } from "@/projects/script/script-txt-parser";

export type CanonicalEpisodeInput = {
  episodeNumber: number;
  title: string;
  content: string;
};

function normalizeTitleForHeader(
  episodeNumber: number,
  title: string,
): string {
  const trimmed = title.trim();
  // Avoid "第N集：第N集：标题" when title already embeds the episode label.
  const alreadyLabeled =
    new RegExp(`^第\\s*${episodeNumber}\\s*集`).test(trimmed) ||
    new RegExp(`^Episode\\s*${episodeNumber}\\b`, "i").test(trimmed);
  if (alreadyLabeled) {
    return trimmed;
  }
  return `第${episodeNumber}集：${trimmed}`;
}

export function buildCanonicalScriptSourceText(
  episodes: readonly CanonicalEpisodeInput[],
): string {
  const sorted = [...episodes].sort(
    (a, b) => a.episodeNumber - b.episodeNumber,
  );
  const parts: string[] = [];
  for (const ep of sorted) {
    const header = normalizeTitleForHeader(ep.episodeNumber, ep.title);
    const body = ep.content.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    parts.push(`${header}\n\n${body}`);
  }
  return parts.join("\n\n");
}

/** Round-trip helper for tests: canonical text → parse → compare semantics. */
export function canonicalEpisodesRoundTripEquivalent(
  episodes: readonly CanonicalEpisodeInput[],
): boolean {
  const source = buildCanonicalScriptSourceText(episodes);
  const parsed = parseScriptTxtEpisodes(source);
  if (parsed.episodes.length !== episodes.length) return false;
  const sorted = [...episodes].sort(
    (a, b) => a.episodeNumber - b.episodeNumber,
  );
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    const b = parsed.episodes[i]!;
    if (a.episodeNumber !== b.episodeNumber) return false;
    if (a.content.replace(/\r\n/g, "\n").trim() !== b.content.trim()) {
      return false;
    }
  }
  return true;
}

export function toCanonicalEpisodeInputs(
  episodes: readonly ScriptEpisode[],
): CanonicalEpisodeInput[] {
  return episodes.map((ep) => ({
    episodeNumber: ep.episodeNumber,
    title: ep.title,
    content: ep.content,
  }));
}
