import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { applyParsedDesignToEpisodeRecord } from "@/projects/assets/episode-design/apply-generation";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import {
  getOrCreateEpisodeRecord,
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import { loadScriptDraft } from "@/projects/script/script-draft-store";

export async function persistEpisodeExtractToDesignRecord(input: {
  projectId: string;
  episodeId: string;
  parsed: EpisodeAssetDesignGenerationDto;
  generationId: string;
}): Promise<void> {
  const draft = await loadScriptDraft(input.projectId);
  const episode = draft?.episodes.find((item) => item.id === input.episodeId);
  if (!episode) return;

  const designStore = await loadEpisodeAssetDesignStore(input.projectId);
  const created = getOrCreateEpisodeRecord(
    designStore,
    episode.id,
    episode.episodeNumber,
  );
  const bundle = await loadAssetBundleDraft(input.projectId);
  const next = applyParsedDesignToEpisodeRecord({
    record: created.record,
    parsed: input.parsed,
    bundle: bundle ?? {
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
    contentFingerprint: getScriptEpisodeContentFingerprint({
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      content: episode.content,
    }),
    generationId: input.generationId,
  });
  await saveEpisodeAssetDesignStore(upsertEpisodeRecord(created.store, next));
}
