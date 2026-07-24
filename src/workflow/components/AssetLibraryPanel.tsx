"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Mic2,
  Mountain,
  Package,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { WORKFLOW_ASSET_MIME } from "@/workflow/lib/drop-asset";
import { parseMentionAssetIds } from "@/workflow/lib/mention-tokens";
import { useWorkflowStore } from "@/workflow/store";
import type { AssetRecord, AssetType, WorkflowDocument } from "@/workflow/types";

type AssetCategory = "all" | "character" | "scene" | "prop" | "audio";

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  all: "全部",
  character: "角色",
  scene: "场景",
  prop: "道具",
  audio: "音频",
};

const CATEGORY_TYPES: Record<Exclude<AssetCategory, "all">, AssetType[]> = {
  character: ["characterImage"],
  scene: ["sceneImage"],
  prop: ["propImage"],
  audio: ["audio"],
};

function assetIdsForNode(document: WorkflowDocument, nodeId: string): string[] {
  const node = document.nodes.find((n) => n.id === nodeId);
  if (!node) return [];

  const ids: string[] = [];

  switch (node.type) {
    case "character":
      if (node.data.voiceAssetId) ids.push(node.data.voiceAssetId);
      ids.push(...(node.data.generationHistoryIds ?? []));
      ids.push(...(node.data.voiceHistoryIds ?? []));
      ids.push(...parseMentionAssetIds(node.data.appearancePrompt));
      ids.push(...parseMentionAssetIds(node.data.voicePrompt));
      ids.push(...parseMentionAssetIds(node.data.description));
      for (const variant of node.data.variants) {
        if (variant.primaryAssetId) ids.push(variant.primaryAssetId);
        ids.push(...variant.referenceAssetIds);
        for (const ref of variant.references) {
          if (ref.assetId) ids.push(ref.assetId);
        }
      }
      break;
    case "scene":
      if (node.data.primaryAssetId) ids.push(node.data.primaryAssetId);
      ids.push(...node.data.referenceAssetIds);
      ids.push(...(node.data.generationHistoryIds ?? []));
      ids.push(...parseMentionAssetIds(node.data.generationPrompt));
      ids.push(...parseMentionAssetIds(node.data.description));
      for (const vp of node.data.viewpoints) {
        if (vp.assetId) ids.push(vp.assetId);
      }
      break;
    case "image":
      if (node.data.primaryAssetId) ids.push(node.data.primaryAssetId);
      ids.push(...node.data.assetIds);
      ids.push(...parseMentionAssetIds(node.data.description));
      break;
    case "prop":
      if (node.data.primaryAssetId) ids.push(node.data.primaryAssetId);
      ids.push(...node.data.assetIds);
      ids.push(...parseMentionAssetIds(node.data.description));
      break;
    case "audio":
      if (node.data.assetId) ids.push(node.data.assetId);
      break;
    case "text":
      ids.push(...parseMentionAssetIds(node.data.content));
      break;
    case "videoShot":
      if (node.data.sourceVideoAssetId) ids.push(node.data.sourceVideoAssetId);
      if (node.data.startFrameAssetId) ids.push(node.data.startFrameAssetId);
      if (node.data.endFrameAssetId) ids.push(node.data.endFrameAssetId);
      if (node.data.resultAssetId) ids.push(node.data.resultAssetId);
      ids.push(...node.data.attachedAssetIds);
      ids.push(...(node.data.generationHistoryIds ?? []));
      ids.push(...parseMentionAssetIds(node.data.generationInstruction));
      ids.push(...parseMentionAssetIds(node.data.actionDescription));
      break;
    default:
      break;
  }

  return ids;
}

function collectAssetIdsForVideoShot(
  document: WorkflowDocument,
  videoShotId: string,
): Set<string> {
  const ids = new Set<string>();

  for (const id of assetIdsForNode(document, videoShotId)) {
    ids.add(id);
  }

  for (const edge of document.edges) {
    if (edge.target !== videoShotId) continue;
    for (const id of assetIdsForNode(document, edge.source)) {
      ids.add(id);
    }
  }

  return ids;
}

export function countVideoShotUsage(
  document: WorkflowDocument,
  assetId: string,
): number {
  const videoShots = document.nodes.filter((n) => n.type === "videoShot");
  let count = 0;

  for (const shot of videoShots) {
    const refs = collectAssetIdsForVideoShot(document, shot.id);
    if (refs.has(assetId)) count += 1;
  }

  return count;
}

export function isAssetReferencedInDocument(
  document: WorkflowDocument,
  assetId: string,
): boolean {
  for (const node of document.nodes) {
    if (assetIdsForNode(document, node.id).includes(assetId)) {
      return true;
    }
  }
  return false;
}

function categoryIcon(category: AssetCategory) {
  switch (category) {
    case "character":
      return <UserRound className="h-3.5 w-3.5" />;
    case "scene":
      return <Mountain className="h-3.5 w-3.5" />;
    case "prop":
      return <Package className="h-3.5 w-3.5" />;
    case "audio":
      return <Mic2 className="h-3.5 w-3.5" />;
    default:
      return null;
  }
}

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  projectId: string;
};

export function AssetLibraryPanel({ collapsed, onToggle, projectId }: Props) {
  const assets = useWorkflowStore((s) => s.document.assets);
  const documentNodes = useWorkflowStore((s) => s.document.nodes);
  const documentEdges = useWorkflowStore((s) => s.document.edges);
  const updateAsset = useWorkflowStore((s) => s.updateAsset);
  const removeAsset = useWorkflowStore((s) => s.removeAsset);

  const [category, setCategory] = useState<AssetCategory>("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const documentSnapshot = useMemo<WorkflowDocument>(
    () => ({
      version: 4,
      projectId,
      revision: 0,
      nodes: documentNodes,
      edges: documentEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
      assets,
      shotOrder: [],
      updatedAt: "",
    }),
    [projectId, documentNodes, documentEdges, assets],
  );

  const filteredAssets = useMemo(() => {
    let list = assets;

    if (category !== "all") {
      const allowed = CATEGORY_TYPES[category];
      list = list.filter((a) => allowed.includes(a.assetType));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.originalFileName.toLowerCase().includes(q),
      );
    }

    return [...list].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [assets, category, search]);

  const onDeleteAsset = async (asset: AssetRecord) => {
    setDeleteError(null);

    if (isAssetReferencedInDocument(documentSnapshot, asset.id)) {
      setDeleteError(`「${asset.name}」仍被节点引用，无法删除`);
      return;
    }

    setDeletingId(asset.id);
    try {
      const res = await fetch(
        `/api/assets/${asset.id}?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? "删除失败");
      }
      removeAsset(asset.id);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "删除素材失败",
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/95">
        <button
          type="button"
          className="flex h-12 items-center justify-center border-b border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          onClick={onToggle}
          title="展开素材库"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div
          className="flex flex-1 items-center justify-center text-[10px] text-zinc-600"
          style={{ writingMode: "vertical-rl" }}
        >
          素材库
        </div>
      </div>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/95 text-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <div className="text-xs font-semibold tracking-wide text-zinc-300">
          素材库
        </div>
        <button
          type="button"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          onClick={onToggle}
          title="收起素材库"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-zinc-800 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 pl-7 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-500"
            placeholder="搜索素材名称…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
        {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] ${
              category === key
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            }`}
            onClick={() => setCategory(key)}
          >
            {categoryIcon(key)}
            {CATEGORY_LABEL[key]}
          </button>
        ))}
      </div>

      {deleteError && (
        <div className="mx-2 mt-2 rounded-lg border border-rose-500/30 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200">
          {deleteError}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-auto p-2">
        {filteredAssets.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-[11px] text-zinc-500">
            暂无素材。可在节点中上传，或将素材拖到画布使用
          </div>
        )}

        {filteredAssets.map((asset) => {
          const usage = countVideoShotUsage(documentSnapshot, asset.id);
          const referenced = isAssetReferencedInDocument(
            documentSnapshot,
            asset.id,
          );

          return (
            <div
              key={asset.id}
              draggable
              className="cursor-grab rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 transition hover:border-zinc-600 active:cursor-grabbing"
              title="拖到画布使用；右键可删除"
              onDragStart={(e) => {
                e.dataTransfer.setData(WORKFLOW_ASSET_MIME, asset.id);
                e.dataTransfer.setData("text/plain", asset.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  assetId: asset.id,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950"
                  title={
                    asset.assetType === "audio" ||
                    asset.assetType === "generatedVideo"
                      ? undefined
                      : "双击放大预览"
                  }
                  disabled={
                    asset.assetType === "audio" ||
                    asset.assetType === "generatedVideo"
                  }
                  onDoubleClick={() => {
                    if (
                      asset.assetType === "audio" ||
                      asset.assetType === "generatedVideo"
                    ) {
                      return;
                    }
                    setPreview({ src: asset.url, alt: asset.name });
                  }}
                >
                  {asset.assetType === "audio" ? (
                    <div className="flex h-full w-full items-center justify-center text-zinc-500">
                      <Mic2 className="h-4 w-4" />
                    </div>
                  ) : asset.assetType === "generatedVideo" ? (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-300">
                      <Film className="h-4 w-4" />
                    </div>
                  ) : (
                    <AssetThumb
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.name}
                    />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-100 outline-none hover:border-zinc-700 focus:border-zinc-600"
                    value={asset.name}
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateAsset(asset.id, { name: e.target.value })
                    }
                  />
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {usage > 0
                      ? `${usage} 个镜头引用`
                      : referenced
                        ? "已被节点引用"
                        : "未使用"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {contextMenu &&
        (() => {
          const asset = assets.find((a) => a.id === contextMenu.assetId);
          if (!asset) return null;
          const referenced = isAssetReferencedInDocument(
            documentSnapshot,
            asset.id,
          );
          const busy = deletingId === asset.id;
          return (
            <div
              className="fixed z-[80] min-w-[140px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={busy || referenced}
                title={
                  referenced ? "仍被节点引用，无法删除" : "删除该素材"
                }
                onClick={() => {
                  setContextMenu(null);
                  void onDeleteAsset(asset);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {busy ? "删除中…" : referenced ? "无法删除（已引用）" : "删除"}
              </button>
            </div>
          );
        })()}

      <ImageLightbox
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </aside>
  );
}
