import type { AiCapabilityId } from "@/ai-config/capabilities";

export type AssetExtractionPhase = "roster" | "detail";

export const ASSET_ROSTER_EXTRACT_CAPABILITY = "asset.roster.extract" as const;
export const ASSET_DETAIL_EXTRACT_CAPABILITY = "asset.detail.extract" as const;

export function assetExtractionPhaseToCapabilityId(
  phase: AssetExtractionPhase,
): AiCapabilityId {
  return phase === "roster"
    ? ASSET_ROSTER_EXTRACT_CAPABILITY
    : ASSET_DETAIL_EXTRACT_CAPABILITY;
}

/** Legacy output kinds — read-only history; must not start new extraction tasks. */
export const LEGACY_ASSET_EXTRACT_OUTPUT_KINDS = [
  "script_asset_design",
  "episode_asset_design",
] as const;

export function isLegacyAssetExtractOutputKind(outputKind: string): boolean {
  return (LEGACY_ASSET_EXTRACT_OUTPUT_KINDS as readonly string[]).includes(
    outputKind,
  );
}
