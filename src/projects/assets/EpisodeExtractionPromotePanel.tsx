"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveDesignItemPreviewUrl } from "@/projects/assets/episode-design/approved-item";
import type {
  EpisodeAssetDesignAssetType,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";

type Props = {
  open: boolean;
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle?: string | null;
  items: EpisodeAssetDesignItem[];
  expectedRevision: number;
  fingerprint: string;
  approvalEnabled: boolean;
  context: "management" | "workspace";
  libraryAssets?: {
    characters: CharacterAsset[];
    scenes: SceneAsset[];
    props: PropAsset[];
  };
  onClose: () => void;
  onCompleted: (message: string) => void;
};

const ASSET_TYPE_LABEL: Record<EpisodeAssetDesignAssetType, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  audio: "音频",
};

function defaultSelectedIds(items: EpisodeAssetDesignItem[]): Set<string> {
  return new Set(
    items
      .filter(
        (item) =>
          !item.libraryAssetId?.trim() &&
          item.resolution !== "ignore" &&
          item.resolution !== "pending",
      )
      .map((item) => item.id),
  );
}

function itemDescription(item: EpisodeAssetDesignItem): string {
  const draft = item.draft as { description?: string; usage?: string };
  return (draft.description ?? draft.usage ?? item.note ?? "").trim();
}

function itemStatusLabel(item: EpisodeAssetDesignItem): string {
  if (item.libraryAssetId?.trim()) return "已入库";
  if (item.resolution === "ignore") return "已忽略";
  if (item.resolution === "pending") return "待处理";
  return "待选择";
}

export function EpisodeExtractionPromotePanel({
  open,
  projectId,
  episodeId,
  episodeNumber,
  episodeTitle,
  items,
  expectedRevision,
  fingerprint,
  approvalEnabled,
  context,
  libraryAssets,
  onClose,
  onCompleted,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    defaultSelectedIds(items),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setSelected(defaultSelectedIds(items));
      setError("");
    });
  }, [items, open]);

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;

  const selectableItems = useMemo(
    () => items.filter((item) => !item.libraryAssetId?.trim()),
    [items],
  );
  const selectedCount = useMemo(
    () => selectableItems.filter((item) => selected.has(item.id)).length,
    [selectableItems, selected],
  );
  const promoteAllowed = !approvalEnabled;

  const toggleItem = useCallback((itemId: string, inLibrary: boolean) => {
    if (inLibrary) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const handlePromote = useCallback(async () => {
    if (submitting) return;
    const itemIds = selectableItems
      .filter((item) => selected.has(item.id))
      .map((item) => item.id);
    if (itemIds.length === 0) {
      setError("请至少选择一项资产。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (approvalEnabled) {
        const mediaIds = items
          .filter((item) => selected.has(item.id))
          .map((item) => item.generatedMedia?.currentId?.trim())
          .filter((id): id is string => Boolean(id));
        if (mediaIds.length === 0) {
          throw new Error("所选资产尚无可用图片，无法提交审批。");
        }
        const res = await fetch(
          `/api/workspace/projects/${encodeURIComponent(projectId)}/asset-approvals`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `promote-${episodeId}-${[...mediaIds].sort().join(",")}`,
            },
            body: JSON.stringify({
              episodeId,
              generatedMediaIds: mediaIds,
            }),
          },
        );
        const payload = (await res.json()) as {
          error?: string;
          counts?: { total: number };
        };
        if (!res.ok) throw new Error(payload.error ?? "提交审批失败");
        onCompleted(
          `已提交 ${payload.counts?.total ?? mediaIds.length} 项资产审批，等待主理人处理。`,
        );
        onClose();
        return;
      }

      const res = await fetch(
        `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            episodeId,
            itemIds,
            expectedRevision,
            fingerprint,
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        counts?: {
          created: number;
          linked: number;
          skipped: number;
          failed: number;
        };
      };
      if (!res.ok) throw new Error(payload.error ?? "加入资产库失败");
      const created = payload.counts?.created ?? 0;
      const linked = payload.counts?.linked ?? 0;
      const skipped = payload.counts?.skipped ?? 0;
      const promoted = created + linked;
      onCompleted(
        promoted > 0
          ? `已加入 ${promoted} 项资产${skipped > 0 ? `，跳过 ${skipped} 项已存在资产` : ""}。`
          : skipped > 0
            ? `跳过 ${skipped} 项已存在资产，未新增资产。`
            : "操作完成。",
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [
    apiRoot,
    approvalEnabled,
    episodeId,
    expectedRevision,
    fingerprint,
    items,
    onClose,
    onCompleted,
    projectId,
    selectableItems,
    selected,
    submitting,
  ]);

  if (!open) return null;

  const titleSuffix = episodeTitle?.trim() ? ` · ${episodeTitle.trim()}` : "";

  return (
    <div
      className="ead-modal-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="episode-extraction-promote-backdrop"
    >
      <div
        className="ead-modal ead-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="episode-extraction-promote-title"
        onClick={(event) => event.stopPropagation()}
        data-testid="episode-extraction-promote-panel"
      >
        <header className="ead-modal__head">
          <div>
            <h2 id="episode-extraction-promote-title">
              第 {episodeNumber} 集提取结果{titleSuffix}
            </h2>
            <p className="ead-approval-modal__sub">
              共 {items.length} 项 · 已选 {selectedCount} 项
            </p>
          </div>
          <button type="button" className="amw-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        {items.length === 0 ? (
          <p className="amw-note" data-testid="episode-extraction-promote-empty">
            当前剧集没有可选择的提取结果。
          </p>
        ) : (
          <ul className="episode-extraction-promote-list">
            {items.map((item) => {
              const inLibrary = Boolean(item.libraryAssetId?.trim());
              const checked = selected.has(item.id);
              const previewUrl = resolveDesignItemPreviewUrl(
                projectId,
                item,
                libraryAssets,
              );
              return (
                <li
                  key={item.id}
                  className={`episode-extraction-promote-item${inLibrary ? " is-in-library" : ""}`}
                  data-testid={`episode-extraction-promote-item-${item.id}`}
                >
                  <label className="episode-extraction-promote-item__select">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={inLibrary || submitting}
                      onChange={() => toggleItem(item.id, inLibrary)}
                    />
                  </label>
                  <div className="episode-extraction-promote-item__preview">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="" />
                    ) : (
                      <span className="episode-extraction-promote-item__placeholder">
                        无预览
                      </span>
                    )}
                  </div>
                  <div className="episode-extraction-promote-item__body">
                    <div className="episode-extraction-promote-item__title-row">
                      <strong>{item.name}</strong>
                      <span className="episode-extraction-promote-item__type">
                        {ASSET_TYPE_LABEL[item.assetType]}
                      </span>
                      <span
                        className={`episode-extraction-promote-item__status${inLibrary ? " is-in-library" : ""}`}
                      >
                        {itemStatusLabel(item)}
                      </span>
                    </div>
                    <p className="episode-extraction-promote-item__meta">
                      来源：第 {episodeNumber} 集
                    </p>
                    {itemDescription(item) ? (
                      <p className="episode-extraction-promote-item__desc">
                        {itemDescription(item)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error ? (
          <p className="amw-note amw-note--error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="ead-modal__foot">
          <button
            type="button"
            className="amw-btn"
            disabled={submitting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            disabled={submitting || selectedCount === 0 || items.length === 0}
            aria-busy={submitting}
            data-testid="episode-extraction-promote-submit"
            onClick={() => void handlePromote()}
          >
            {submitting
              ? "处理中…"
              : approvalEnabled
                ? `提交选中资产审批（已选 ${selectedCount} 项）`
                : promoteAllowed
                  ? `加入资产库（已选 ${selectedCount} 项）`
                  : "加入资产库（已选 0 项）"}
          </button>
        </footer>
      </div>
    </div>
  );
}
