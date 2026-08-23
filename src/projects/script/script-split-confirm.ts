import { randomUUID } from "crypto";
import {
  getScriptSourceFingerprint,
  type ScriptDraft,
} from "@/projects/script/script-draft-store";
import { episodeContentFingerprint } from "@/projects/script/script-split-reconstruct";
import type { ProposedEpisode } from "@/projects/script/script-split-types";
import { countVisibleChars } from "@/text-generation/char-count";
import type { ScriptEpisode } from "@/projects/script/types";

export type ConfirmScriptSplitInput = {
  draft: ScriptDraft;
  sourceFingerprint: string;
  confirmedRevision: number;
  proposedEpisodes?: ProposedEpisode[];
  idempotencyKey: string;
};

export function scriptSplitConfirmIdempotencyKey(
  sourceFingerprint: string,
): string {
  return `split_confirm_${sourceFingerprint}`;
}

export type ConfirmScriptSplitResult =
  | { ok: true; draft: ScriptDraft; idempotent: boolean }
  | {
      ok: false;
      status: 400 | 409;
      code:
        | "INVALID_REQUEST"
        | "SOURCE_FINGERPRINT_MISMATCH"
        | "SPLIT_STATUS_INVALID"
        | "PROPOSED_EMPTY"
        | "PROPOSED_INVALID"
        | "REVISION_CONFLICT"
        | "ALREADY_CONFIRMED";
      message: string;
    };

function newFormalEpisodeId(): string {
  return `ep_${randomUUID().replace(/-/g, "")}`;
}

function validateProposedEpisodes(
  episodes: ProposedEpisode[],
): { ok: true } | { ok: false; message: string } {
  if (episodes.length === 0) {
    return { ok: false, message: "无待确认的分集方案" };
  }
  const sorted = [...episodes].sort(
    (a, b) => a.episodeNumber - b.episodeNumber,
  );
  for (let i = 0; i < sorted.length; i += 1) {
    const expected = i + 1;
    if (sorted[i]!.episodeNumber !== expected) {
      return {
        ok: false,
        message: `集号必须从 1 起连续，期望 ${expected}，实际 ${sorted[i]!.episodeNumber}`,
      };
    }
    if (!sorted[i]!.title.trim()) {
      return { ok: false, message: `第 ${expected} 集标题不能为空` };
    }
    if (!sorted[i]!.text.trim()) {
      return { ok: false, message: `第 ${expected} 集正文不能为空` };
    }
    const fp = episodeContentFingerprint(sorted[i]!.text);
    if (sorted[i]!.contentFingerprint !== fp) {
      return {
        ok: false,
        message: `第 ${expected} 集内容指纹不匹配`,
      };
    }
  }
  return { ok: true };
}

function mapToFormalEpisodes(
  projectId: string,
  proposed: ProposedEpisode[],
  now: string,
): ScriptEpisode[] {
  return [...proposed]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((ep) => ({
      id: ep.id.startsWith("ep_") ? ep.id : newFormalEpisodeId(),
      projectId,
      episodeNumber: ep.episodeNumber,
      title: ep.title.trim(),
      content: ep.text,
      wordCount: countVisibleChars(ep.text),
      status: "ready" as const,
      createdAt: now,
      updatedAt: now,
    }));
}

export function confirmScriptSplit(
  input: ConfirmScriptSplitInput,
): ConfirmScriptSplitResult {
  const { draft } = input;
  const split = draft.episodeSplit ?? {
    status: "not_started" as const,
    sourceFingerprint: null,
    generationId: null,
    proposedEpisodes: [],
    generatedAt: null,
    confirmedAt: null,
    confirmedRevision: 0,
    errorMessage: null,
  };

  if (!input.idempotencyKey.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "缺少 idempotencyKey",
    };
  }

  const currentFingerprint = getScriptSourceFingerprint(draft.sourceText);
  if (!currentFingerprint || currentFingerprint !== input.sourceFingerprint) {
    return {
      ok: false,
      status: 409,
      code: "SOURCE_FINGERPRINT_MISMATCH",
      message: "源文本已变化，请重新生成分集方案",
    };
  }

  if (split.status === "confirmed" && draft.episodes.length > 0) {
    return { ok: true, draft, idempotent: true };
  }

  if (split.status === "confirmed") {
    return {
      ok: false,
      status: 409,
      code: "ALREADY_CONFIRMED",
      message: "分集方案已确认",
    };
  }

  if (split.status === "stale") {
    return {
      ok: false,
      status: 409,
      code: "SPLIT_STATUS_INVALID",
      message: "分集方案已过期，请重新生成",
    };
  }

  if (split.status !== "review") {
    return {
      ok: false,
      status: 400,
      code: "SPLIT_STATUS_INVALID",
      message: "当前状态不可确认分集",
    };
  }

  if (input.confirmedRevision !== split.confirmedRevision) {
    return {
      ok: false,
      status: 409,
      code: "REVISION_CONFLICT",
      message: "分集方案版本冲突，请刷新后重试",
    };
  }

  const proposed =
    input.proposedEpisodes && input.proposedEpisodes.length > 0
      ? input.proposedEpisodes
      : split.proposedEpisodes;

  if (proposed.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "PROPOSED_EMPTY",
      message: "无待确认的分集方案",
    };
  }

  const validated = validateProposedEpisodes(proposed);
  if (!validated.ok) {
    return {
      ok: false,
      status: 400,
      code: "PROPOSED_INVALID",
      message: validated.message,
    };
  }

  const now = new Date().toISOString();
  const episodes = mapToFormalEpisodes(draft.projectId, proposed, now);
  const nextRevision = split.confirmedRevision + 1;

  const nextDraft: ScriptDraft = {
    ...draft,
    episodes,
    selectedId: episodes[0]?.id ?? draft.selectedId,
    episodeSplit: {
      ...split,
      status: "confirmed",
      confirmedAt: now,
      confirmedRevision: nextRevision,
      generationId: null,
      proposedEpisodes: proposed,
      lastConfirmIdempotencyKey: input.idempotencyKey,
      errorMessage: null,
    },
    updatedAt: now,
  };

  return { ok: true, draft: nextDraft, idempotent: false };
}
