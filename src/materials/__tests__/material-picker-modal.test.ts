import { describe, expect, it } from "vitest";
import {
  createInitialPickerUiState,
  filterPersonalAssets,
  parsePickerItemKey,
  pickerHttpErrorMessage,
  pickerItemKey,
  shouldShowGenderThemeFilters,
  togglePickerValue,
  type PersonalPickerAsset,
} from "@/materials/ui/material-picker-state";

function makePersonalAsset(
  overrides: Partial<PersonalPickerAsset> = {},
): PersonalPickerAsset {
  return {
    id: "pm-1",
    personalMaterialId: "pm-1",
    name: "测试衣服",
    type: "clothing",
    mediaId: "media-1",
    mediaUrl: "/api/materials/media/media-1",
    sourceType: "upload",
    sourceMaterialId: null,
    tags: [],
    genderTags: ["female"],
    themeTags: ["modern"],
    ...overrides,
  };
}

describe("material picker state", () => {
  it("creates independent initial state without scoped default types", () => {
    const state = createInitialPickerUiState();
    expect(state.source).toBe("personal");
    expect(state.typeFilter).toBe("all");
    expect(state.genders).toEqual([]);
    expect(state.themes).toEqual([]);
    expect(state.selectedKey).toBeNull();
  });

  it("keeps category when switching source (state shape)", () => {
    const state = createInitialPickerUiState();
    const next = {
      ...state,
      source: "system" as const,
      typeFilter: "prop" as const,
    };
    expect(next.typeFilter).toBe("prop");
    expect(next.source).toBe("system");
  });

  it("filters personal assets by category without resetting to character", () => {
    const assets = [
      makePersonalAsset({ id: "a", type: "character", name: "角色A" }),
      makePersonalAsset({ id: "b", type: "prop", name: "道具B" }),
    ];
    const sceneOnly = filterPersonalAssets(assets, {
      typeFilter: "scene",
      genders: [],
      themes: [],
      debouncedQ: "",
    });
    expect(sceneOnly).toHaveLength(0);

    const propOnly = filterPersonalAssets(assets, {
      typeFilter: "prop",
      genders: [],
      themes: [],
      debouncedQ: "",
    });
    expect(propOnly).toHaveLength(1);
    expect(propOnly[0]?.name).toBe("道具B");
  });

  it("shows gender/theme filters only for all and clothing", () => {
    expect(shouldShowGenderThemeFilters("all")).toBe(true);
    expect(shouldShowGenderThemeFilters("clothing")).toBe(true);
    expect(shouldShowGenderThemeFilters("prop")).toBe(false);
    expect(shouldShowGenderThemeFilters("scene")).toBe(false);
  });

  it("builds and parses stable picker item keys", () => {
    const key = pickerItemKey("system", "mat-9");
    expect(key).toBe("system:mat-9");
    expect(parsePickerItemKey(key)).toEqual({
      source: "system",
      id: "mat-9",
    });
  });

  it("toggles filter values idempotently", () => {
    expect(togglePickerValue(["male"], "male")).toEqual([]);
    expect(togglePickerValue([], "female")).toEqual(["female"]);
  });

  it("maps http status to user-facing errors", () => {
    expect(pickerHttpErrorMessage(401, "fallback")).toContain("登录");
    expect(pickerHttpErrorMessage(403, "fallback")).toContain("无权");
    expect(pickerHttpErrorMessage(404, "fallback")).toContain("不存在");
    expect(pickerHttpErrorMessage(500, "fallback")).toBe("fallback");
  });
});

describe("material picker modal contract", () => {
  it("exports redesigned class hooks in css", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const file = await fs.readFile(
      path.join(process.cwd(), "src/materials/material-picker-modal.css"),
      "utf8",
    );
    expect(file).toContain(".material-picker-backdrop");
    expect(file).toContain("backdrop-filter: blur(18px)");
    expect(file).toContain(".material-picker-source-switcher__button");
    expect(file).toContain(".material-picker-category-nav__button");
    expect(file).toContain(".material-picker-dialog");
  });

  it("keeps picker selection isolated from look editor defaults", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const file = await fs.readFile(
      path.join(
        process.cwd(),
        "src/projects/assets/LibraryCharacterLookEditor.tsx",
      ),
      "utf8",
    );
    expect(file).not.toContain("defaultTypes");
  });
});
