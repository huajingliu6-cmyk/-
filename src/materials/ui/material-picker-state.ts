import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MATERIAL_GENDER_OPTIONS,
  MATERIAL_THEME_OPTIONS,
  materialMediaUrl,
} from "@/materials/constants";
import { materialMatchesQuery } from "@/materials/filters";
import type {
  Material,
  MaterialGenderTag,
  MaterialSort,
  MaterialType,
  PersonalMaterial,
} from "@/materials/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";

export type PickerSource = "personal" | "system";
export type PickerTypeFilter = MaterialType | "all";

export type PersonalPickerAsset = {
  id: string;
  personalMaterialId: string;
  name: string;
  type: MaterialType;
  mediaId: string;
  mediaUrl: string;
  sourceType: PersonalMaterial["sourceType"];
  sourceMaterialId: string | null;
  tags: string[];
  genderTags: MaterialGenderTag[];
  themeTags: string[];
  description?: string;
};

export type PickerSelection =
  | { source: "personal"; asset: PersonalPickerAsset }
  | { source: "system"; material: Material };

export type MaterialPickerUiState = {
  source: PickerSource;
  typeFilter: PickerTypeFilter;
  genders: MaterialGenderTag[];
  themes: string[];
  q: string;
  debouncedQ: string;
  sort: MaterialSort;
  selectedKey: string | null;
};

export function createInitialPickerUiState(): MaterialPickerUiState {
  return {
    source: "personal",
    typeFilter: "all",
    genders: [],
    themes: [],
    q: "",
    debouncedQ: "",
    sort: "all",
    selectedKey: null,
  };
}

export function pickerItemKey(source: PickerSource, id: string): string {
  return `${source}:${id}`;
}

export function parsePickerItemKey(
  key: string,
): { source: PickerSource; id: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const source = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if ((source !== "personal" && source !== "system") || !id) return null;
  return { source, id };
}

export function togglePickerValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

export function shouldShowGenderThemeFilters(
  typeFilter: PickerTypeFilter,
): boolean {
  return typeFilter === "all" || typeFilter === "clothing";
}

function asMaterialLike(asset: PersonalPickerAsset): Material {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    mediaId: asset.mediaId,
    description: asset.description ?? "",
    tags: asset.tags,
    genderTags: asset.genderTags,
    themeTags: asset.themeTags,
    sortOrder: 0,
    status: "active",
    citeCount: 0,
    createdBy: "",
    createdAt: "",
    updatedAt: "",
  };
}

export function filterPersonalAssets(
  assets: PersonalPickerAsset[],
  state: Pick<
    MaterialPickerUiState,
    "typeFilter" | "genders" | "themes" | "debouncedQ"
  >,
): PersonalPickerAsset[] {
  const showGenderTheme = shouldShowGenderThemeFilters(state.typeFilter);
  return assets.filter((asset) =>
    materialMatchesQuery(asMaterialLike(asset), {
      type: state.typeFilter === "all" ? undefined : state.typeFilter,
      genders: showGenderTheme ? state.genders : [],
      themes: showGenderTheme ? state.themes : [],
      q: state.debouncedQ,
    }),
  );
}

export function pickerHttpErrorMessage(
  status: number,
  fallback: string,
): string {
  if (status === 401) return "登录已过期，请重新登录";
  if (status === 403) return "无权访问素材库";
  if (status === 404) return "素材不存在或已下架";
  return fallback;
}

function normalizePersonalRow(row: PersonalPickerAsset): PersonalPickerAsset {
  const id = row.personalMaterialId || row.id;
  return {
    ...row,
    id,
    personalMaterialId: id,
    mediaUrl:
      row.mediaUrl || (row.mediaId ? materialMediaUrl(row.mediaId) : ""),
    sourceType: row.sourceType ?? "upload",
    sourceMaterialId: row.sourceMaterialId ?? null,
    tags: row.tags ?? [],
    genderTags: row.genderTags ?? [],
    themeTags: row.themeTags ?? [],
  };
}

type UseMaterialPickerDataOptions = {
  open: boolean;
  ui: MaterialPickerUiState;
  onError: (message: string) => void;
};

export function useMaterialPickerData({
  open,
  ui,
  onError,
}: UseMaterialPickerDataOptions) {
  const [personalAssets, setPersonalAssets] = useState<PersonalPickerAsset[]>(
    [],
  );
  const [systemMaterials, setSystemMaterials] = useState<Material[]>([]);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [personalLoaded, setPersonalLoaded] = useState(false);
  const [systemLoaded, setSystemLoaded] = useState(false);

  const personalAbortRef = useRef<AbortController | null>(null);
  const systemRequestId = useRef(0);
  const lastErrorRef = useRef<string | null>(null);

  const reportError = useCallback(
    (message: string) => {
      if (lastErrorRef.current === message) return;
      lastErrorRef.current = message;
      onError(message);
    },
    [onError],
  );

  const loadPersonal = useCallback(async () => {
    personalAbortRef.current?.abort();
    const controller = new AbortController();
    personalAbortRef.current = controller;
    setPersonalLoading(true);
    try {
      const res = await fetch("/api/materials/my-library", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const data = await parseResponseJson<{
        assets?: PersonalPickerAsset[];
        materials?: PersonalPickerAsset[];
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(
          data.error ||
            pickerHttpErrorMessage(res.status, "加载个人空间失败"),
        );
      }
      const rows = (data.assets ?? data.materials ?? []).map(normalizePersonalRow);
      setPersonalAssets(rows);
      setPersonalLoaded(true);
      lastErrorRef.current = null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      reportError(
        error instanceof Error ? error.message : "加载个人空间失败",
      );
    } finally {
      if (!controller.signal.aborted) {
        setPersonalLoading(false);
      }
    }
  }, [reportError]);

  useEffect(() => {
    if (!open) return;
    void loadPersonal();
    return () => {
      personalAbortRef.current?.abort();
    };
  }, [open, loadPersonal]);

  useEffect(() => {
    if (!open || ui.source !== "system") return;

    const controller = new AbortController();
    const requestId = ++systemRequestId.current;
    setSystemLoading(true);

    void (async () => {
      try {
        const params = new URLSearchParams();
        params.set("includeDeleted", "0");
        if (ui.typeFilter !== "all") params.set("type", ui.typeFilter);
        if (ui.debouncedQ.trim()) params.set("q", ui.debouncedQ.trim());
        if (ui.genders.length) params.set("genders", ui.genders.join(","));
        if (ui.themes.length) params.set("themes", ui.themes.join(","));
        if (ui.sort !== "all") params.set("sort", ui.sort);

        const res = await fetch(`/api/materials?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          requestId !== systemRequestId.current
        ) {
          return;
        }
        const data = await parseResponseJson<{
          materials?: Material[];
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(
            data.error ||
              pickerHttpErrorMessage(res.status, "加载系统素材失败"),
          );
        }
        setSystemMaterials(data.materials ?? []);
        setSystemLoaded(true);
        lastErrorRef.current = null;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (requestId !== systemRequestId.current) return;
        reportError(
          error instanceof Error ? error.message : "加载系统素材失败",
        );
      } finally {
        if (requestId === systemRequestId.current) {
          setSystemLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    open,
    ui.source,
    ui.typeFilter,
    ui.debouncedQ,
    ui.genders,
    ui.themes,
    ui.sort,
    reportError,
  ]);

  const citedSystemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const asset of personalAssets) {
      if (asset.sourceMaterialId) ids.add(asset.sourceMaterialId);
    }
    return ids;
  }, [personalAssets]);

  const visiblePersonal = useMemo(
    () => filterPersonalAssets(personalAssets, ui),
    [personalAssets, ui],
  );

  const visibleSystem = useMemo(
    () => systemMaterials.filter((item) => item.status === "active"),
    [systemMaterials],
  );

  const findPersonalBySystemId = useCallback(
    (materialId: string) =>
      personalAssets.find((asset) => asset.sourceMaterialId === materialId) ??
      null,
    [personalAssets],
  );

  const resolveSelection = useCallback(
    (key: string | null): PickerSelection | null => {
      if (!key) return null;
      const parsed = parsePickerItemKey(key);
      if (!parsed) return null;
      if (parsed.source === "personal") {
        const asset = personalAssets.find((item) => item.id === parsed.id);
        return asset ? { source: "personal", asset } : null;
      }
      const material = systemMaterials.find((item) => item.id === parsed.id);
      return material ? { source: "system", material } : null;
    },
    [personalAssets, systemMaterials],
  );

  const loading =
    ui.source === "personal"
      ? personalLoading && !personalLoaded
      : systemLoading && !systemLoaded;
  const refreshing =
    ui.source === "personal" ? personalLoading : systemLoading;

  return {
    personalAssets,
    systemMaterials,
    visiblePersonal,
    visibleSystem,
    citedSystemIds,
    findPersonalBySystemId,
    resolveSelection,
    reloadPersonal: loadPersonal,
    loading,
    refreshing,
    personalLoaded,
    systemLoaded,
  };
}

export function useMaterialPickerUiState(open: boolean) {
  const [ui, setUi] = useState<MaterialPickerUiState>(createInitialPickerUiState);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setUi(createInitialPickerUiState());
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setUi((prev) => ({ ...prev, debouncedQ: prev.q }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, ui.q]);

  const setSource = useCallback((source: PickerSource) => {
    setUi((prev) => ({ ...prev, source, selectedKey: null }));
  }, []);

  const setTypeFilter = useCallback((typeFilter: PickerTypeFilter) => {
    setUi((prev) => ({ ...prev, typeFilter, selectedKey: null }));
  }, []);

  const setSort = useCallback((sort: MaterialSort) => {
    setUi((prev) => ({ ...prev, sort }));
  }, []);

  const setQuery = useCallback((q: string) => {
    setUi((prev) => ({ ...prev, q }));
  }, []);

  const toggleGender = useCallback((gender: MaterialGenderTag) => {
    setUi((prev) => ({
      ...prev,
      genders: togglePickerValue(prev.genders, gender),
      selectedKey: null,
    }));
  }, []);

  const toggleTheme = useCallback((theme: string) => {
    setUi((prev) => ({
      ...prev,
      themes: togglePickerValue(prev.themes, theme),
      selectedKey: null,
    }));
  }, []);

  const selectKey = useCallback((key: string | null) => {
    setUi((prev) => ({ ...prev, selectedKey: key }));
  }, []);

  const clearSelection = useCallback(() => {
    setUi((prev) => ({ ...prev, selectedKey: null }));
  }, []);

  return {
    ui,
    setSource,
    setTypeFilter,
    setSort,
    setQuery,
    toggleGender,
    toggleTheme,
    selectKey,
    clearSelection,
  };
}

export const PICKER_SORT_OPTIONS: Array<{ id: MaterialSort; label: string }> = [
  { id: "all", label: "默认排序" },
  { id: "newest", label: "最新" },
  { id: "popular", label: "最多引用" },
];

export const PICKER_GENDER_OPTIONS = MATERIAL_GENDER_OPTIONS;
export const PICKER_THEME_OPTIONS = MATERIAL_THEME_OPTIONS;
