import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("compact asset deletion flow", () => {
  const list = readSrc("src/projects/assets/AssetCompactList.tsx");
  const characterList = readSrc("src/projects/assets/CharacterList.tsx");
  const character = readSrc("src/projects/assets/CharacterManager.tsx");
  const scene = readSrc("src/projects/assets/SceneManager.tsx");
  const prop = readSrc("src/projects/assets/PropManager.tsx");
  const dialog = readSrc("src/projects/assets/AssetDeleteInUseDialog.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("confirms the first two consecutive deletes and resets on other actions", () => {
    expect(list).toContain("CONFIRMED_DELETE_LIMIT = 2");
    expect(list).toContain("confirmedDeleteCount >= CONFIRMED_DELETE_LIMIT");
    expect(list).toContain('role="alertdialog"');
    expect(list).toContain("pointerdown");
    expect(list).toContain("keydown");
    expect(list).toContain("setConfirmedDeleteCount(0)");
    expect(list).toContain('data-asset-delete-control="true"');
    expect(list).toContain('outcome === "in_use"');
  });

  it("managers delete via dedicated API instead of PUT filter", () => {
    expect(characterList).toContain("onDelete={onDelete}");
    for (const manager of [character, scene, prop]) {
      expect(manager).toContain("deleteLibraryAssetClient");
      expect(manager).toContain("unlinkStoryboardRefs");
      expect(manager).toContain("AssetDeleteInUseDialog");
      expect(manager).not.toContain("await onPersist(next)");
      expect(manager).toContain("onDelete={canEdit ? handleDelete : undefined}");
    }
  });

  it("in-use dialog shows shot count and unlink action", () => {
    expect(dialog).toContain("正在被 ${shotCount} 个镜头使用");
    expect(dialog).toContain("解除关联并删除");
    expect(dialog).toContain('data-testid="asset-delete-in-use-dialog"');
    expect(dialog).toContain('data-testid="asset-delete-in-use-confirm"');
    expect(dialog).toContain("samples.slice(0, 3)");
  });

  it("renders a right-side close control and an inline confirmation card", () => {
    expect(css).toContain(".asset-compact-list__delete");
    expect(css).toContain(".asset-compact-list__delete-confirm");
    expect(css).toMatch(/\.asset-compact-list__delete\s*\{[\s\S]*?right:\s*8px/);
  });
});
