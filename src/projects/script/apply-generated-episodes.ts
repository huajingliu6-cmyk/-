/**
 * Merge structured episode generation DTO into an existing ScriptDraft.
 * Single-episode semantics: replace or insert by episode number.
 */

import { randomUUID } from "crypto";
import {
  buildCanonicalScriptSourceText,
  toCanonicalEpisodeInputs,
} from "@/projects/script/build-canonical-script-source-text";
import type { ScriptDraft } from "@/projects/script/script-draft-store";
import type { ScriptEpisodesGenerationDto } from "@/projects/script/script-episodes-generation-schema";
import {
  outlineContentFingerprint,
  parseScriptEpisodesGenerationOutput,
} from "@/projects/script/script-episodes-generation-schema";
import { countVisibleChars } from "@/text-generation/char-count";
import type { ScriptEpisode } from "@/projects/script/types";

export type ApplyGeneratedEpisodesInput = {
  previous: ScriptDraft;
  dto: ScriptEpisodesGenerationDto;
  expectedUpdatedAt?: string;
  expectedOutlineFingerprint?: string;
};

export type ApplyGeneratedEpisodesResult =
  | { ok: true; draft: ScriptDraft }
  | {
      ok: false;
      status: 409 | 400;
      code:
        | "SCRIPT_DRAFT_CONFLICT"
        | "OUTLINE_FINGERPRINT_MISMATCH"
        | "SCRIPT_EPISODES_OUTPUT_INVALID"
        | "OUTLINE_REQUIRED";
      message: string;
    };

function newEpisodeId(): string {
  return `ep_${randomUUID().replace(/-/g, "")}`;
}

function mergeSingleEpisode(
  projectId: string,
  existing: ScriptEpisode[],
  number: number,
  title: string,
  content: string,
  now: string,
): ScriptEpisode[] {
  const next = existing.map((ep) => ({ ...ep }));
  const idx = next.findIndex((ep) => ep.episodeNumber === number);
  const wordCount = countVisibleChars(content);
  if (idx >= 0) {
    const prev = next[idx]!;
    next[idx] = {
      ...prev,
      title,
      content,
      wordCount,
      status: "ready",
      updatedAt: now,
    };
  } else {
    next.push({
      id: newEpisodeId(),
      projectId,
      episodeNumber: number,
      title,
      content,
      wordCount,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
  }
  next.sort((a, b) => a.episodeNumber - b.episodeNumber);
  return next;
}

export function applyGeneratedEpisodesToDraft(
  input: ApplyGeneratedEpisodesInput,
): ApplyGeneratedEpisodesResult {
  const { previous, dto } = input;
  const outline = previous.outlineText?.trim() ?? "";
  if (!outline) {
    return {
      ok: false,
      status: 400,
      code: "OUTLINE_REQUIRED",
      message: "请先保存大纲后再应用剧集。",
    };
  }

  if (
    typeof input.expectedOutlineFingerprint === "string" &&
    outlineContentFingerprint(previous.outlineText ?? "") !==
      input.expectedOutlineFingerprint
  ) {
    return {
      ok: false,
      status: 409,
      code: "OUTLINE_FINGERPRINT_MISMATCH",
      message: "大纲已发生变化，请基于最新大纲重新生成剧集。",
    };
  }

  if (
    typeof input.expectedUpdatedAt === "string" &&
    input.expectedUpdatedAt !== previous.updatedAt
  ) {
    return {
      ok: false,
      status: 409,
      code: "SCRIPT_DRAFT_CONFLICT",
      message: "剧本草稿已更新，请重新加载后再应用。",
    };
  }

  // Re-validate DTO (server-side); single-episode product semantics.
  const recheck = parseScriptEpisodesGenerationOutput(
    JSON.stringify(dto),
    {
      expectedCount: 1,
      expectedEpisodeNumber: dto.episodes[0]?.number,
    },
  );
  if (!recheck.ok) {
    return {
      ok: false,
      status: 400,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: recheck.message,
    };
  }

  const generated = recheck.value.episodes[0]!;
  const now = new Date().toISOString();
  const episodes = mergeSingleEpisode(
    previous.projectId,
    previous.episodes,
    generated.number,
    generated.title,
    generated.content,
    now,
  );
  const sourceText = buildCanonicalScriptSourceText(
    toCanonicalEpisodeInputs(episodes),
  );

  const draft: ScriptDraft = {
    ...previous,
    episodes,
    sourceText,
    // Formal script no longer equals the original imported file.
    sourceImport: null,
    sourceFile: null,
    preambleNotes: null,
    outlineText: previous.outlineText,
    selectedId:
      episodes.find((ep) => ep.episodeNumber === generated.number)?.id ??
      previous.selectedId,
    updatedAt: now,
  };

  return { ok: true, draft };
}
