import "server-only";

import { afterScriptSplitConfirmed } from "@/projects/assets/extraction/after-confirm";
import type { AfterScriptConfirmAction } from "@/projects/assets/extraction/after-confirm";
import {
  getScriptSourceFingerprint,
  saveScriptDraft,
  type ScriptDraft,
} from "@/projects/script/script-draft-store";
import { buildLocalProposedEpisodes } from "@/projects/script/local-script-split";
import {
  confirmScriptSplit,
  scriptSplitConfirmIdempotencyKey,
} from "@/projects/script/script-split-confirm";
import { emptyEpisodeSplitState } from "@/projects/script/script-split-types";
import { readDurableDownstreamSyncStatus } from "@/projects/workspace-sync/sync-management-to-workspace";
import type { WorkspaceSnapshot } from "@/projects/workspace-sync/types";

export const EXISTING_EPISODES_PRESERVED = "EXISTING_EPISODES_PRESERVED";
export const LOCAL_SPLIT_EMPTY = "LOCAL_SPLIT_EMPTY";
export const SOURCE_TEXT_REQUIRED = "SOURCE_TEXT_REQUIRED";

export type ScriptDownstreamSyncPayload = {
  syncStatus: WorkspaceSnapshot["syncStatus"];
  syncError: string | null;
  operationId: string | null;
  parentOperationId: string | null;
  retryPath: string;
};

export type ScriptAutoSplitSuccess = {
  ok: true;
  draft: ScriptDraft;
  idempotent: boolean;
  mode: "title" | "blocks" | "existing";
  warnings: string[];
  downstreamSync: ScriptDownstreamSyncPayload;
  extractionAction: AfterScriptConfirmAction["action"];
};

export type ScriptAutoSplitFailure = {
  ok: false;
  status: 400 | 409;
  code:
    | typeof EXISTING_EPISODES_PRESERVED
    | typeof LOCAL_SPLIT_EMPTY
    | typeof SOURCE_TEXT_REQUIRED
    | "PROPOSED_EMPTY"
    | "PROPOSED_INVALID"
    | "SPLIT_STATUS_INVALID"
    | "REVISION_CONFLICT"
    | "ALREADY_CONFIRMED"
    | "SOURCE_FINGERPRINT_MISMATCH"
    | "INVALID_REQUEST";
  message: string;
  draft: ScriptDraft | null;
  warnings: string[];
  downstreamSync: ScriptDownstreamSyncPayload | null;
};

function hasExistingFormalEpisodes(draft: ScriptDraft | null): boolean {
  return Boolean(draft && draft.episodes.length > 0);
}

async function attachDownstream(
  projectId: string,
): Promise<ScriptDownstreamSyncPayload> {
  const status = await readDurableDownstreamSyncStatus(projectId);
  return {
    syncStatus: status.syncStatus,
    syncError: status.syncError,
    operationId: status.operationId,
    parentOperationId: status.parentOperationId,
    retryPath: status.retryPath,
  };
}

/**
 * Apply existing local-split rules, then confirm into formal episodes in one save.
 * Same source fingerprint / confirmed revision is a no-op. Confirmed different
 * source is never overwritten.
 */
export async function commitImportedScriptAutoSplit(input: {
  previous: ScriptDraft | null;
  nextDraft: ScriptDraft;
}): Promise<ScriptAutoSplitSuccess | ScriptAutoSplitFailure> {
  const { previous, nextDraft } = input;
  const incomingFp = getScriptSourceFingerprint(nextDraft.sourceText);
  if (!incomingFp) {
    return {
      ok: false,
      status: 400,
      code: SOURCE_TEXT_REQUIRED,
      message: "缺少可分集的剧本源文本",
      draft: previous,
      warnings: [],
      downstreamSync: null,
    };
  }

  if (hasExistingFormalEpisodes(previous)) {
    const previousFp = getScriptSourceFingerprint(previous!.sourceText);
    if (previousFp === incomingFp) {
      const extraction = await afterScriptSplitConfirmed({
        projectId: previous!.projectId,
        sourceFingerprint: incomingFp,
      });
      return {
        ok: true,
        draft: previous!,
        idempotent: true,
        mode: "existing",
        warnings: [],
        downstreamSync: await attachDownstream(previous!.projectId),
        extractionAction: extraction.action,
      };
    }
    return {
      ok: false,
      status: 409,
      code: EXISTING_EPISODES_PRESERVED,
      message:
        "已有确认剧集，上传未覆盖现有剧集、确认状态或下游生成结果。",
      draft: previous,
      warnings: [],
      downstreamSync: await attachDownstream(previous!.projectId),
    };
  }

  const split = buildLocalProposedEpisodes(nextDraft.sourceText ?? "");
  const proposed = split.proposedEpisodes.filter((ep) => ep.text.trim());
  if (proposed.length === 0) {
    const failedDraft: ScriptDraft = {
      ...nextDraft,
      episodes: previous?.episodes ?? [],
      selectedId: previous?.selectedId ?? nextDraft.selectedId,
      episodeSplit: {
        ...(nextDraft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed",
        generationId: null,
        sourceFingerprint: incomingFp,
        errorMessage: "无法识别分集：未得到有效剧集正文",
        proposedEpisodes: [],
      },
    };
    const saved = await saveScriptDraft(failedDraft);
    return {
      ok: false,
      status: 400,
      code: LOCAL_SPLIT_EMPTY,
      message: "无法识别分集：未得到有效剧集正文",
      draft: saved,
      warnings: split.warnings,
      downstreamSync: await attachDownstream(saved.projectId),
    };
  }

  const prevSplit = nextDraft.episodeSplit ?? emptyEpisodeSplitState();
  const reviewDraft: ScriptDraft = {
    ...nextDraft,
    episodes: [],
    selectedId: null,
    episodeSplit: {
      ...prevSplit,
      status: "review",
      sourceFingerprint: incomingFp,
      generationId: null,
      proposedEpisodes: proposed,
      generatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  };

  const confirmed = confirmScriptSplit({
    draft: reviewDraft,
    sourceFingerprint: incomingFp,
    confirmedRevision: prevSplit.confirmedRevision,
    proposedEpisodes: proposed,
    idempotencyKey: scriptSplitConfirmIdempotencyKey(incomingFp),
  });
  if (!confirmed.ok) {
    const failedDraft: ScriptDraft = {
      ...nextDraft,
      episodes: previous?.episodes ?? [],
      episodeSplit: {
        ...(nextDraft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed",
        sourceFingerprint: incomingFp,
        errorMessage: confirmed.message,
        proposedEpisodes: proposed,
      },
    };
    const saved = await saveScriptDraft(failedDraft);
    return {
      ok: false,
      status: confirmed.status,
      code: confirmed.code === "ALREADY_CONFIRMED"
        ? EXISTING_EPISODES_PRESERVED
        : confirmed.code,
      message: confirmed.message,
      draft: saved,
      warnings: split.warnings,
      downstreamSync: await attachDownstream(saved.projectId),
    };
  }

  const saved = confirmed.idempotent
    ? confirmed.draft
    : await saveScriptDraft(confirmed.draft);
  const extraction = await afterScriptSplitConfirmed({
    projectId: saved.projectId,
    sourceFingerprint: incomingFp,
  });
  return {
    ok: true,
    draft: saved,
    idempotent: confirmed.idempotent,
    mode: split.mode,
    warnings: split.warnings,
    downstreamSync: await attachDownstream(saved.projectId),
    extractionAction: extraction.action,
  };
}

export async function attachScriptDownstreamSync(
  projectId: string,
): Promise<ScriptDownstreamSyncPayload> {
  return attachDownstream(projectId);
}
