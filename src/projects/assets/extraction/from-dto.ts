import { dtoItemsToDesignItems } from "@/projects/assets/episode-design/match";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import { designItemToExtractedAsset } from "@/projects/assets/extraction/items";
import { originalAiFingerprint } from "@/projects/assets/extraction/identity";
import type { ExtractedAsset } from "@/projects/assets/extraction/types";

export function dtoToExtractedAssets(
  dto: EpisodeAssetDesignGenerationDto,
  sourceEpisodeId: string | null,
): ExtractedAsset[] {
  return dtoItemsToDesignItems(dto).map((item) => {
    const extracted = designItemToExtractedAsset(item, sourceEpisodeId);
    return {
      ...extracted,
      originalAiFingerprint: originalAiFingerprint(extracted.draft),
    };
  });
}

export function extractedAssetsToDto(
  assets: ExtractedAsset[],
): EpisodeAssetDesignGenerationDto {
  return {
    version: 1,
    assets: assets.map((asset) => {
      const draft = asset.draft as Record<string, unknown>;
      const evidence =
        typeof draft.evidence === "string" ? draft.evidence : undefined;
      const design = { ...draft };
      delete design.evidence;
      return {
        type: asset.assetType,
        name: asset.name,
        description:
          typeof draft.description === "string" ? draft.description : undefined,
        design: design as EpisodeAssetDesignGenerationDto["assets"][number]["design"],
        evidence,
      };
    }),
  };
}
