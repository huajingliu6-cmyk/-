import {
  detectExtractionConflicts,
} from "@/projects/assets/extraction/conflicts";
import { mergedAssetsForVersion } from "@/projects/assets/extraction/materialize";
import { mergeExtractedAssets } from "@/projects/assets/extraction/merge";
import {
  getActiveVersion,
  getCandidateVersion,
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import { materializeActiveVersionToBundle } from "@/projects/assets/extraction/materialize";
import type {
  AssetManualOverride,
  ConflictDecision,
  ExtractedAsset,
} from "@/projects/assets/extraction/types";

export async function applyCandidateVersion(input: {
  projectId: string;
  decisions?: ConflictDecision[];
}): Promise<
  | { ok: true; conflicts?: undefined }
  | { ok: false; code: "NO_CANDIDATE"; message: string }
  | {
      ok: false;
      code: "CONFLICTS_REQUIRE_CONFIRM";
      message: string;
    }
> {
  let requiredConfirm = false;
  let missingCandidate = false;
  const saved = await mutateAssetExtractionStore(input.projectId, (store) => {
    const candidate = getCandidateVersion(store);
    const active = getActiveVersion(store);
    if (!candidate) {
      missingCandidate = true;
      return store;
    }
    const candidateAssets = mergedAssetsForVersion(store, candidate.id);
    const activeAssets = active
      ? mergedAssetsForVersion(store, active.id)
      : [];
    const overrides = store.overrides.filter(
      (override) => override.versionId === (active?.id ?? ""),
    );
    const conflicts = detectExtractionConflicts({
      activeAssets,
      candidateAssets,
      overrides,
    });
    if (conflicts.length > 0 && !input.decisions) {
      requiredConfirm = true;
      return store;
    }

    const decisionByIdentity = new Map(
      (input.decisions ?? []).map((decision) => [decision.identity, decision]),
    );
    const nextAssets = resolveAssets({
      activeAssets,
      candidateAssets,
      conflicts,
      decisions: decisionByIdentity,
    });
    const now = new Date().toISOString();
    const nextOverrides: AssetManualOverride[] = nextAssets.flatMap((asset) => {
      const decision = decisionByIdentity.get(asset.identity);
      const previous = overrides.find(
        (override) => override.assetIdentity === asset.identity,
      );
      if (decision?.choice === "keep_manual" || decision?.choice === "keep") {
        return previous
          ? [{ ...previous, versionId: candidate.id, updatedAt: now }]
          : [];
      }
      return [];
    });

    return {
      ...store,
      versions: store.versions.map((version) => {
        if (version.id === candidate.id) {
          return { ...version, status: "active" as const };
        }
        if (version.id === active?.id) {
          return { ...version, status: "archived" as const };
        }
        return version;
      }),
      results: [
        ...store.results.filter((result) => result.versionId !== candidate.id),
        {
          versionId: candidate.id,
          scope: "all" as const,
          episodeId: null,
          assets: nextAssets,
        },
      ],
      overrides: [
        ...store.overrides.filter(
          (override) =>
            override.versionId !== candidate.id &&
            override.versionId !== active?.id,
        ),
        ...nextOverrides,
      ],
      updatedAt: now,
    };
  });

  if (requiredConfirm) {
    return {
      ok: false,
      code: "CONFLICTS_REQUIRE_CONFIRM",
      message: "存在人工修改冲突，请逐项确认后再应用",
    };
  }
  if (missingCandidate) {
    return { ok: false, code: "NO_CANDIDATE", message: "没有可应用的候选结果" };
  }
  await materializeActiveVersionToBundle(input.projectId, saved);
  return { ok: true };
}

function resolveAssets(input: {
  activeAssets: ExtractedAsset[];
  candidateAssets: ExtractedAsset[];
  conflicts: ReturnType<typeof detectExtractionConflicts>;
  decisions: Map<string, ConflictDecision>;
}): ExtractedAsset[] {
  const conflictIdentities = new Set(
    input.conflicts.map((conflict) => conflict.identity),
  );
  const kept: ExtractedAsset[] = [];
  const candidateByIdentity = new Map(
    input.candidateAssets.map((asset) => [asset.identity, asset]),
  );
  const activeByIdentity = new Map(
    input.activeAssets.map((asset) => [asset.identity, asset]),
  );

  for (const asset of input.candidateAssets) {
    if (!conflictIdentities.has(asset.identity)) {
      kept.push(asset);
      continue;
    }
    const decision = input.decisions.get(asset.identity);
    if (decision?.choice === "keep_manual") {
      kept.push(activeByIdentity.get(asset.identity) ?? asset);
    } else {
      kept.push(asset);
    }
  }

  for (const conflict of input.conflicts) {
    if (conflict.kind !== "removed") continue;
    const decision = input.decisions.get(conflict.identity);
    if (decision?.choice === "keep" && conflict.activeAsset) {
      kept.push(conflict.activeAsset);
    }
  }

  return mergeExtractedAssets([kept]);
}
