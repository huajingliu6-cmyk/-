export type EpisodeSplitStatus =
  | "not_started"
  | "generating"
  | "review"
  | "failed"
  | "stale"
  | "confirmed";

export type ProposedEpisode = {
  id: string;
  episodeNumber: number;
  title: string;
  text: string;
  contentFingerprint: string;
};

export type ScriptEpisodeSplitState = {
  status: EpisodeSplitStatus;
  sourceFingerprint: string | null;
  generationId: string | null;
  proposedEpisodes: ProposedEpisode[];
  generatedAt: string | null;
  confirmedAt: string | null;
  confirmedRevision: number;
  errorMessage: string | null;
  /** Last successful confirm idempotency key (optional). */
  lastConfirmIdempotencyKey?: string | null;
};

export function emptyEpisodeSplitState(): ScriptEpisodeSplitState {
  return {
    status: "not_started",
    sourceFingerprint: null,
    generationId: null,
    proposedEpisodes: [],
    generatedAt: null,
    confirmedAt: null,
    confirmedRevision: 0,
    errorMessage: null,
    lastConfirmIdempotencyKey: null,
  };
}
