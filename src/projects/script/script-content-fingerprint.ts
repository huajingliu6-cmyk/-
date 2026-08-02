import type { ScriptDraft } from "@/projects/script/script-draft-store";
import type { ScriptEpisode } from "@/projects/script/types";

/**
 * Content fingerprint for script-change detection.
 * Ignores IDs, timestamps, and sourceImport.importedAt.
 */
export function scriptDraftContentFingerprint(
  draft: Pick<ScriptDraft, "episodes" | "sourceText" | "preambleNotes"> | {
    episodes: ScriptEpisode[];
    sourceText?: string | null;
    preambleNotes?: string | null;
  },
): string {
  const sourceText = draft.sourceText ?? "";
  const preamble = draft.preambleNotes ?? "";
  const episodePart = draft.episodes
    .map(
      (ep) =>
        `${ep.episodeNumber}\u0000${ep.title}\u0000${ep.content}`,
    )
    .join("\n---\n");
  return `${sourceText}\u0000${preamble}\u0000${episodePart}`;
}

export function scriptDraftContentChanged(
  previous: ScriptDraft | null,
  next: Pick<ScriptDraft, "episodes" | "sourceText" | "preambleNotes">,
): boolean {
  if (!previous) {
    return next.episodes.length > 0 || Boolean(next.sourceText?.trim());
  }
  return (
    scriptDraftContentFingerprint(previous) !==
    scriptDraftContentFingerprint(next)
  );
}
