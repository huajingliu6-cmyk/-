import type {
  Material,
  MaterialGenderTag,
  MaterialListQuery,
  MaterialSort,
} from "@/materials/types";

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function materialMatchesQuery(
  material: Material,
  query: MaterialListQuery,
): boolean {
  if (!query.includeDeleted && material.status !== "active") return false;
  if (query.type && material.type !== query.type) return false;

  const genders = query.genders?.filter(Boolean) ?? [];
  if (genders.length > 0) {
    // Strict match: selected filter tags must intersect material tags.
    // "unrestricted" on a material only matches when the user also selects "unrestricted".
    const hit = genders.some((g) => material.genderTags.includes(g));
    if (!hit) return false;
  }

  const themes = query.themes?.filter(Boolean) ?? [];
  if (themes.length > 0) {
    const hit = themes.some((t) => material.themeTags.includes(t));
    if (!hit) return false;
  }

  const q = normalizeText(query.q);
  if (q) {
    const haystack = [
      material.name,
      material.description,
      ...material.tags,
      ...material.themeTags,
      ...material.genderTags,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export function sortMaterials(
  materials: Material[],
  sort: MaterialSort = "all",
): Material[] {
  const copy = [...materials];
  if (sort === "newest") {
    copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return copy;
  }
  if (sort === "popular") {
    copy.sort((a, b) => {
      if (b.citeCount !== a.citeCount) return b.citeCount - a.citeCount;
      return a.sortOrder - b.sortOrder;
    });
    return copy;
  }
  copy.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return copy;
}

export function filterAndSortMaterials(
  materials: Material[],
  query: MaterialListQuery,
): Material[] {
  return sortMaterials(
    materials.filter((m) => materialMatchesQuery(m, query)),
    query.sort ?? "all",
  );
}

export function parseGenderTags(raw: unknown): MaterialGenderTag[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<MaterialGenderTag>([
    "male",
    "female",
    "child",
    "unrestricted",
  ]);
  const out: MaterialGenderTag[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim() as MaterialGenderTag;
    if (!allowed.has(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function parseThemeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function parseStringTags(raw: unknown): string[] {
  return parseThemeTags(raw);
}

/** At least one gender or theme tag (including unrestricted) is required. */
export function hasRequiredFilterTags(input: {
  genderTags: MaterialGenderTag[];
  themeTags: string[];
}): boolean {
  return input.genderTags.length > 0 || input.themeTags.length > 0;
}
