import type { ProjectCreationSource } from "@/projects/types";

type EntryScriptDraft = {
  sourceImport?: unknown;
  sourceText?: string | null;
  episodes?: Array<{ id: string }>;
} | null;

type EntryAssetStore = {
  records: Array<{
    episodeId: string;
    status: string;
    staleUpstream?: boolean;
  }>;
};

export type ProjectEntryStage = "story" | "script" | "assets" | "storyboard";

function hasScriptContent(draft: EntryScriptDraft): boolean {
  if (!draft) return false;
  return Boolean(
    draft.sourceImport ||
      draft.sourceText?.trim() ||
      (draft.episodes?.length ?? 0) > 0,
  );
}

function isConfirmed(record: EntryAssetStore["records"][number] | undefined) {
  return record?.status === "confirmed" && record.staleUpstream !== true;
}

function hasCompletedAssets(
  draft: EntryScriptDraft,
  assetStore: EntryAssetStore,
  hasActiveVersion = false,
): boolean {
  if (hasActiveVersion) return true;
  const episodeIds = draft?.episodes?.map((episode) => episode.id) ?? [];
  if (episodeIds.length === 0) return false;
  return episodeIds.every((episodeId) =>
    isConfirmed(
      assetStore.records.find((record) => record.episodeId === episodeId),
    ),
  );
}

export function resolveProjectEntryStage(input: {
  creationSource: ProjectCreationSource;
  scriptDraft: EntryScriptDraft;
  assetStore: EntryAssetStore;
  hasActiveVersion?: boolean;
}): ProjectEntryStage {
  if (!hasScriptContent(input.scriptDraft)) {
    return input.creationSource === "story" ? "story" : "script";
  }
  return hasCompletedAssets(
    input.scriptDraft,
    input.assetStore,
    input.hasActiveVersion === true,
  )
    ? "storyboard"
    : "assets";
}

export function projectEntryPath(
  projectId: string,
  stage: ProjectEntryStage,
): string {
  return `/app/projects/${encodeURIComponent(projectId)}/${
    stage === "assets" ? "assets/library" : stage
  }`;
}
