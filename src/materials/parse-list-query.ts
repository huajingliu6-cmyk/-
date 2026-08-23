import type { MaterialListQuery, MaterialSort, MaterialType } from "@/materials/types";
import { parseGenderTags, parseThemeTags } from "@/materials/filters";

function parseType(raw: string | null): MaterialType | null {
  const value = (raw ?? "").trim();
  if (
    value === "character" ||
    value === "clothing" ||
    value === "prop" ||
    value === "scene"
  ) {
    return value;
  }
  return null;
}

function parseSort(raw: string | null): MaterialSort {
  const value = (raw ?? "").trim();
  if (value === "newest" || value === "popular" || value === "all") return value;
  return "all";
}

function splitCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseMaterialListQuery(
  searchParams: URLSearchParams,
): MaterialListQuery {
  return {
    type: parseType(searchParams.get("type")),
    genders: parseGenderTags(splitCsv(searchParams.get("genders"))),
    themes: parseThemeTags(splitCsv(searchParams.get("themes"))),
    q: (searchParams.get("q") ?? "").trim() || undefined,
    sort: parseSort(searchParams.get("sort")),
    includeDeleted: searchParams.get("includeDeleted") === "1",
  };
}
