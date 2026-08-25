import { normalizeAssetName } from "@/projects/storyboard/hash";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import type {
  AssetRosterItem,
  ExtractedAsset,
  PublicAssetRosterItem,
  RosterMatchStatus,
} from "@/projects/assets/extraction/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";

type NamedLibraryHit = {
  name: string;
  normalized: string;
  type: AssetRosterItem["type"];
};

function collectLibraryNames(
  bundle: Pick<ProjectAssetBundle, "characters" | "scenes" | "props" | "audios"> | null | undefined,
): NamedLibraryHit[] {
  if (!bundle) return [];
  const rows: NamedLibraryHit[] = [];
  for (const item of bundle.characters ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    rows.push({
      name,
      normalized: normalizeAssetName(name),
      type: "character",
    });
  }
  for (const item of bundle.scenes ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    rows.push({ name, normalized: normalizeAssetName(name), type: "scene" });
  }
  for (const item of bundle.props ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    rows.push({ name, normalized: normalizeAssetName(name), type: "prop" });
  }
  for (const item of bundle.audios ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    rows.push({ name, normalized: normalizeAssetName(name), type: "audio" });
  }
  return rows;
}

function namesForRosterItem(item: AssetRosterItem): string[] {
  return [item.name, ...(item.aliases ?? [])]
    .map((name) => name.trim())
    .filter(Boolean);
}

function classifyAgainstLibrary(
  item: AssetRosterItem,
  libraryNames: NamedLibraryHit[],
  extractedIdentities: Set<string>,
): { matchStatus: RosterMatchStatus; matchedAssetName: string | null } {
  const identity = assetIdentity(item.type, item.name);
  if (extractedIdentities.has(identity)) {
    const hit = libraryNames.find(
      (row) =>
        row.type === item.type &&
        row.normalized === normalizeAssetName(item.name),
    );
    return {
      matchStatus: "existing",
      matchedAssetName: hit?.name ?? item.name,
    };
  }

  const candidates = namesForRosterItem(item).map((name) =>
    normalizeAssetName(name),
  );
  for (const row of libraryNames) {
    if (row.type !== item.type) continue;
    if (candidates.includes(row.normalized)) {
      return { matchStatus: "existing", matchedAssetName: row.name };
    }
  }

  for (const row of libraryNames) {
    if (row.type !== item.type) continue;
    for (const candidate of candidates) {
      if (!candidate || !row.normalized) continue;
      if (
        candidate.includes(row.normalized) ||
        row.normalized.includes(candidate)
      ) {
        return {
          matchStatus: "possible_duplicate",
          matchedAssetName: row.name,
        };
      }
    }
  }

  return { matchStatus: "new", matchedAssetName: null };
}

/** Annotate roster rows for the selection dialog (new / existing / possible). */
export function annotateRosterForSelection(
  roster: AssetRosterItem[],
  input: {
    extractedAssets?: ExtractedAsset[];
    libraryBundle?: Pick<
      ProjectAssetBundle,
      "characters" | "scenes" | "props" | "audios"
    > | null;
  },
): PublicAssetRosterItem[] {
  const libraryNames = collectLibraryNames(input.libraryBundle);
  const extractedIdentities = new Set(
    (input.extractedAssets ?? []).map((asset) => asset.identity),
  );

  return roster.map((item) => {
    const classified = classifyAgainstLibrary(
      item,
      libraryNames,
      extractedIdentities,
    );
    const selectable = classified.matchStatus !== "existing";
    return {
      ...item,
      matchStatus: classified.matchStatus,
      matchedAssetName: classified.matchedAssetName,
      selectable,
      defaultSelected: classified.matchStatus === "new",
    };
  });
}

export function isExistingRosterKey(
  annotated: PublicAssetRosterItem[],
  assetKey: string,
): boolean {
  const row = annotated.find((item) => item.assetKey === assetKey);
  return row?.matchStatus === "existing";
}
