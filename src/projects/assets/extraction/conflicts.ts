import type {
  AssetManualOverride,
  ExtractedAsset,
  ExtractionConflict,
} from "@/projects/assets/extraction/types";
import { originalAiFingerprint } from "@/projects/assets/extraction/identity";

export function isManualOverrideActive(
  override: AssetManualOverride | undefined,
  asset: ExtractedAsset | null,
): boolean {
  if (!override || !asset) return false;
  return override.originalAiFingerprint === asset.originalAiFingerprint;
}

export function detectExtractionConflicts(input: {
  activeAssets: ExtractedAsset[];
  candidateAssets: ExtractedAsset[];
  overrides: AssetManualOverride[];
}): ExtractionConflict[] {
  const overrideByIdentity = new Map(
    input.overrides.map((override) => [override.assetIdentity, override]),
  );
  const activeByIdentity = new Map(
    input.activeAssets.map((asset) => [asset.identity, asset]),
  );
  const candidateByIdentity = new Map(
    input.candidateAssets.map((asset) => [asset.identity, asset]),
  );
  const conflicts: ExtractionConflict[] = [];

  for (const [identity, active] of activeByIdentity) {
    const override = overrideByIdentity.get(identity);
    if (!override) continue;
    const candidate = candidateByIdentity.get(identity) ?? null;
    if (!candidate) {
      conflicts.push({
        identity,
        kind: "removed",
        assetType: active.assetType,
        name: active.name,
        activeAsset: active,
        candidateAsset: null,
      });
      continue;
    }
    if (candidate.originalAiFingerprint === active.originalAiFingerprint) {
      continue;
    }
    if (candidate.originalAiFingerprint === override.originalAiFingerprint) {
      continue;
    }
    const currentFingerprint = originalAiFingerprint(active.draft);
    if (currentFingerprint === candidate.originalAiFingerprint) {
      continue;
    }
    conflicts.push({
      identity,
      kind: "changed",
      assetType: active.assetType,
      name: active.name,
      activeAsset: active,
      candidateAsset: candidate,
    });
  }

  return conflicts;
}
