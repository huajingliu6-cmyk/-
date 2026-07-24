"use client";

import { useShallow } from "zustand/react/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useWorkflowStore } from "@/workflow/store";
import type { AssetRecord } from "@/workflow/types";

/**
 * 按 id 订阅单个素材。未改动的素材对象引用不变时，节点不会因其他素材增删而重渲染，避免画布闪烁。
 */
export function useAssetById(
  assetId: string | undefined | null,
): AssetRecord | undefined {
  return useWorkflowStore((s) =>
    assetId
      ? s.document.assets.find((asset) => asset.id === assetId)
      : undefined,
  );
}

/**
 * 按 id 列表订阅素材。仅当对应素材引用变化时触发重渲染。
 * 返回顺序与入参 ids 一致（缺省为 undefined）。
 */
export function useAssetsByIds(
  ids: ReadonlyArray<string | undefined | null>,
): Array<AssetRecord | undefined> {
  return useWorkflowStore(
    useShallow((s) =>
      ids.map((id) =>
        id ? s.document.assets.find((asset) => asset.id === id) : undefined,
      ),
    ),
  );
}

/** 画布节点用：仅在库弹层打开时才扫描图片类素材，避免常驻订阅整表 */
export function useLibraryImageAssets(enabled: boolean): AssetRecord[] {
  return useStoreWithEqualityFn(
    useWorkflowStore,
    (s) => {
      if (!enabled) return EMPTY_ASSETS;
      return s.document.assets
        .filter(
          (a) =>
            a.assetType === "characterImage" ||
            a.assetType === "sceneImage" ||
            a.assetType === "propImage" ||
            a.assetType === "referenceImage" ||
            a.assetType === "generatedImage",
        )
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 24);
    },
    libraryListEqual,
  );
}

const EMPTY_ASSETS: AssetRecord[] = [];

function libraryListEqual(a: AssetRecord[], b: AssetRecord[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
