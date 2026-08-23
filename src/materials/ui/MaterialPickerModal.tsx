"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, FolderOpen, Library, X } from "lucide-react";
import {
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPES,
  materialMediaUrl,
} from "@/materials/constants";
import type { Material, PersonalMaterial } from "@/materials/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  AppToastHost,
  useAppToasts,
} from "@/shell/AppToast";
import {
  PICKER_GENDER_OPTIONS,
  PICKER_SORT_OPTIONS,
  PICKER_THEME_OPTIONS,
  pickerItemKey,
  shouldShowGenderThemeFilters,
  useMaterialPickerData,
  useMaterialPickerUiState,
  type PersonalPickerAsset,
} from "@/materials/ui/material-picker-state";
import "@/materials/material-picker-modal.css";

export type MaterialPickerSelection = {
  source: "personal-material" | "system-material";
  personalMaterialId: string;
  materialId?: string | null;
  mediaId: string;
  previewUrl: string;
  name: string;
  type: "character" | "clothing" | "prop" | "scene";
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: MaterialPickerSelection) => void;
  /** 1-based slot index shown in header. */
  slotIndex?: number | null;
  usedPersonalMaterialIds?: string[];
  usedSystemMaterialIds?: string[];
  preventDuplicate?: boolean;
};

function personalSourceLabel(sourceType: PersonalPickerAsset["sourceType"]): string {
  if (sourceType === "system-citation") return "来自系统素材";
  if (sourceType === "generated") return "生成";
  return "上传";
}

function personalStatusLabel(asset: PersonalPickerAsset): string {
  if (asset.sourceType === "system-citation") return "已引用 · 可使用";
  return "可使用";
}

function SkeletonGrid() {
  return (
    <div className="material-picker-skeleton-grid" data-testid="material-picker-skeleton">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="material-picker-skeleton-card">
          <div className="material-picker-skeleton-card__media" />
          <div className="material-picker-skeleton-card__body" />
        </div>
      ))}
    </div>
  );
}

export function MaterialPickerModal({
  open,
  onClose,
  onSelect,
  slotIndex = null,
  usedPersonalMaterialIds = [],
  usedSystemMaterialIds = [],
  preventDuplicate = false,
}: Props) {
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();
  const {
    ui,
    setSource,
    setTypeFilter,
    setSort,
    setQuery,
    toggleGender,
    toggleTheme,
    selectKey,
    clearSelection,
  } = useMaterialPickerUiState(open);

  const {
    visiblePersonal,
    visibleSystem,
    citedSystemIds,
    findPersonalBySystemId,
    resolveSelection,
    reloadPersonal,
    loading,
    refreshing,
  } = useMaterialPickerData({
    open,
    ui,
    onError: pushToast,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicateHint, setDuplicateHint] = useState<string | null>(null);

  const usedPersonalSet = useMemo(
    () => new Set(usedPersonalMaterialIds),
    [usedPersonalMaterialIds],
  );
  const usedSystemSet = useMemo(
    () => new Set(usedSystemMaterialIds),
    [usedSystemMaterialIds],
  );

  const showGenderTheme = shouldShowGenderThemeFilters(ui.typeFilter);
  const selectedCount = ui.selectedKey ? 1 : 0;

  const stopBackdropClose = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!open) {
      setPreviewOpen(false);
      setDuplicateHint(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewOpen) {
        setPreviewOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, previewOpen]);

  const emitPersonalSelection = useCallback(
    (asset: PersonalPickerAsset) => {
      onSelect({
        source: "personal-material",
        personalMaterialId: asset.id,
        materialId: asset.sourceMaterialId,
        mediaId: asset.mediaId,
        previewUrl: asset.mediaUrl,
        name: asset.name,
        type: asset.type,
      });
      onClose();
    },
    [onClose, onSelect],
  );

  const emitSystemSelection = useCallback(
    (material: Material, personalMaterialId: string, mediaId: string) => {
      onSelect({
        source: "system-material",
        personalMaterialId,
        materialId: material.id,
        mediaId,
        previewUrl: materialMediaUrl(mediaId),
        name: material.name,
        type: material.type,
      });
      onClose();
    },
    [onClose, onSelect],
  );

  const checkDuplicate = useCallback(
    (selection: ReturnType<typeof resolveSelection>): boolean => {
      if (!selection) return true;
      if (selection.source === "personal") {
        if (!usedPersonalSet.has(selection.asset.id)) return false;
        const msg = "该素材已在其他参考位使用";
        if (preventDuplicate) {
          setDuplicateHint(msg);
          pushToast(msg, "warning");
          return true;
        }
        setDuplicateHint(msg);
        return false;
      }
      if (!usedSystemSet.has(selection.material.id)) return false;
      const msg = "该系统素材已在其他参考位使用";
      if (preventDuplicate) {
        setDuplicateHint(msg);
        pushToast(msg, "warning");
        return true;
      }
      setDuplicateHint(msg);
      return false;
    },
    [preventDuplicate, pushToast, usedPersonalSet, usedSystemSet],
  );

  const handleUse = useCallback(async () => {
    if (busy) return;
    const selection = resolveSelection(ui.selectedKey);
    if (!selection) return;
    if (checkDuplicate(selection)) return;

    if (selection.source === "personal") {
      emitPersonalSelection(selection.asset);
      return;
    }

    const material = selection.material;
    const existingPersonal = findPersonalBySystemId(material.id);
    if (existingPersonal) {
      emitSystemSelection(material, existingPersonal.id, existingPersonal.mediaId);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/materials/${material.id}/cite`, {
        method: "POST",
      });
      const data = await parseResponseJson<{
        personalMaterial?: PersonalMaterial;
        alreadyCited?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "引用失败");
      const personal = data.personalMaterial;
      if (!personal) throw new Error("引用响应无效");
      await reloadPersonal();
      emitSystemSelection(material, personal.id, personal.mediaId);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "引用失败");
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    checkDuplicate,
    emitPersonalSelection,
    emitSystemSelection,
    findPersonalBySystemId,
    reloadPersonal,
    resolveSelection,
    ui.selectedKey,
    pushToast,
  ]);

  const handleCardClick = useCallback(
    (key: string) => {
      setDuplicateHint(null);
      selectKey(key);
    },
    [selectKey],
  );

  if (!open) return null;

  const selected = resolveSelection(ui.selectedKey);
  const previewCited =
    selected?.source === "system" &&
    citedSystemIds.has(selected.material.id);
  const useButtonLabel =
    selected?.source === "system" && !previewCited
      ? "引用到个人空间并使用"
      : "使用此素材";

  const gridEmpty =
    ui.source === "personal"
      ? visiblePersonal.length === 0
      : visibleSystem.length === 0;

  const modal = (
    <>
      <div
        className="material-picker-backdrop"
        data-testid="material-picker-modal"
        onClick={(event) => {
          stopBackdropClose(event);
          onClose();
        }}
      >
        <div
          className="material-picker-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="选择参考素材"
          onClick={stopBackdropClose}
          onMouseDown={stopBackdropClose}
        >
          <header className="material-picker-header">
            <div className="material-picker-header__titles">
              <h2 className="material-picker-header__title">选择参考素材</h2>
              {slotIndex != null ? (
                <p
                  className="material-picker-header__slot"
                  data-testid="material-picker-slot-label"
                >
                  当前槽位：第 {slotIndex + 1} 张
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="material-picker-header__close"
              data-testid="material-picker-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className="material-picker-controls">
            <div
              className="material-picker-source-switcher"
              data-testid="material-picker-source-switcher"
            >
              <button
                type="button"
                className={`material-picker-source-switcher__button${
                  ui.source === "personal" ? " is-active" : ""
                }`}
                data-testid="material-picker-tab-personal"
                onClick={() => setSource("personal")}
              >
                <FolderOpen
                  className="material-picker-source-switcher__icon"
                  aria-hidden
                />
                个人空间
              </button>
              <button
                type="button"
                className={`material-picker-source-switcher__button${
                  ui.source === "system" ? " is-active" : ""
                }`}
                data-testid="material-picker-tab-system"
                onClick={() => setSource("system")}
              >
                <Library
                  className="material-picker-source-switcher__icon"
                  aria-hidden
                />
                系统素材
              </button>
            </div>

            <nav
              className="material-picker-category-nav"
              aria-label="素材分类"
              data-testid="material-picker-category-nav"
            >
              <button
                type="button"
                className={`material-picker-category-nav__button${
                  ui.typeFilter === "all" ? " is-active" : ""
                }`}
                data-testid="material-picker-type-all"
                onClick={() => setTypeFilter("all")}
              >
                全部
              </button>
              {MATERIAL_TYPES.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`material-picker-category-nav__button${
                    ui.typeFilter === id ? " is-active" : ""
                  }`}
                  data-testid={`material-picker-type-${id}`}
                  onClick={() => setTypeFilter(id)}
                >
                  {MATERIAL_TYPE_LABELS[id]}
                </button>
              ))}
            </nav>

            <div className="material-picker-filter-bar">
              {showGenderTheme ? (
                <>
                  <div className="material-picker-filter-bar__row">
                    <span className="material-picker-filter-bar__label">性别</span>
                    {PICKER_GENDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`material-picker-filter-chip${
                          ui.genders.includes(opt.id) ? " is-active" : ""
                        }`}
                        data-testid={`material-picker-gender-${opt.id}`}
                        onClick={() => toggleGender(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="material-picker-filter-bar__row">
                    <span className="material-picker-filter-bar__label">主题</span>
                    {PICKER_THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`material-picker-filter-chip${
                          ui.themes.includes(opt.id) ? " is-active" : ""
                        }`}
                        data-testid={`material-picker-theme-${opt.id}`}
                        onClick={() => toggleTheme(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="material-picker-filter-bar__tools">
                <input
                  className="material-picker-filter-bar__search"
                  data-testid="material-picker-search"
                  placeholder="搜索名称、描述或标签"
                  value={ui.q}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {ui.source === "system" ? (
                  <select
                    className="material-picker-filter-bar__sort"
                    data-testid="material-picker-sort"
                    value={ui.sort}
                    onChange={(event) =>
                      setSort(event.target.value as typeof ui.sort)
                    }
                  >
                    {PICKER_SORT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>

          <div className="material-picker-content" data-testid="material-picker-content">
            {loading ? (
              <SkeletonGrid />
            ) : gridEmpty ? (
              <div className="material-picker-empty-state" data-testid="material-picker-empty">
                <p className="material-picker-empty-state__title">暂无素材</p>
                <p className="material-picker-empty-state__hint">
                  {ui.source === "personal"
                    ? "可先在个人空间上传，或从系统素材引用。"
                    : "尝试切换分类或调整筛选条件。"}
                </p>
              </div>
            ) : ui.source === "personal" ? (
              <div className="material-picker-grid">
                {visiblePersonal.map((asset) => {
                  const key = pickerItemKey("personal", asset.id);
                  const selectedCard = ui.selectedKey === key;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`material-picker-card${
                        selectedCard ? " is-selected" : ""
                      }`}
                      data-testid={`material-picker-card-personal-${asset.id}`}
                      onClick={() => handleCardClick(key)}
                      onDoubleClick={() => {
                        handleCardClick(key);
                        setPreviewOpen(true);
                      }}
                    >
                      {selectedCard ? (
                        <span className="material-picker-card__check" aria-hidden>
                          <Check size={14} />
                        </span>
                      ) : null}
                      <span className="material-picker-card__source">个人空间</span>
                      <div
                        className="material-picker-card__media"
                        data-testid={`material-picker-card-media-personal-${asset.id}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.mediaUrl} alt={asset.name} />
                      </div>
                      <div className="material-picker-card__body">
                        <h3 className="material-picker-card__title">{asset.name}</h3>
                        <div className="material-picker-card__meta">
                          {MATERIAL_TYPE_LABELS[asset.type]}
                        </div>
                        <div className="material-picker-card__tags">
                          {asset.genderTags.slice(0, 2).map((tag) => (
                            <span key={tag} className="material-picker-card__tag">
                              {PICKER_GENDER_OPTIONS.find((o) => o.id === tag)?.label ??
                                tag}
                            </span>
                          ))}
                          {asset.themeTags.slice(0, 2).map((tag) => (
                            <span key={tag} className="material-picker-card__tag">
                              {PICKER_THEME_OPTIONS.find((o) => o.id === tag)?.label ??
                                tag}
                            </span>
                          ))}
                        </div>
                        <div className="material-picker-card__status">
                          {personalSourceLabel(asset.sourceType)} ·{" "}
                          {personalStatusLabel(asset)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="material-picker-grid">
                {visibleSystem.map((material) => {
                  const key = pickerItemKey("system", material.id);
                  const selectedCard = ui.selectedKey === key;
                  const cited = citedSystemIds.has(material.id);
                  return (
                    <button
                      key={material.id}
                      type="button"
                      className={`material-picker-card${
                        selectedCard ? " is-selected" : ""
                      }`}
                      data-testid={`material-picker-card-system-${material.id}`}
                      onClick={() => handleCardClick(key)}
                      onDoubleClick={() => {
                        handleCardClick(key);
                        setPreviewOpen(true);
                      }}
                    >
                      {selectedCard ? (
                        <span className="material-picker-card__check" aria-hidden>
                          <Check size={14} />
                        </span>
                      ) : null}
                      <span className="material-picker-card__source">系统素材</span>
                      <div
                        className="material-picker-card__media"
                        data-testid={`material-picker-card-media-system-${material.id}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={materialMediaUrl(material.mediaId)}
                          alt={material.name}
                        />
                      </div>
                      <div className="material-picker-card__body">
                        <h3 className="material-picker-card__title">{material.name}</h3>
                        <div className="material-picker-card__meta">
                          {MATERIAL_TYPE_LABELS[material.type]}
                        </div>
                        <div className="material-picker-card__tags">
                          {material.genderTags.slice(0, 2).map((tag) => (
                            <span key={tag} className="material-picker-card__tag">
                              {PICKER_GENDER_OPTIONS.find((o) => o.id === tag)?.label ??
                                tag}
                            </span>
                          ))}
                          {material.themeTags.slice(0, 2).map((tag) => (
                            <span key={tag} className="material-picker-card__tag">
                              {PICKER_THEME_OPTIONS.find((o) => o.id === tag)?.label ??
                                tag}
                            </span>
                          ))}
                        </div>
                        <div className="material-picker-card__status">
                          {cited ? "已引用" : "可引用"} · 可使用
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {refreshing && !loading ? (
              <p className="material-picker-empty-state__hint" style={{ marginTop: 12 }}>
                正在更新列表…
              </p>
            ) : null}
          </div>

          <footer className="material-picker-footer">
            <span
              className="material-picker-footer__summary"
              data-testid="material-picker-selected-count"
            >
              已选择 {selectedCount} 张
            </span>
            <div className="material-picker-footer__actions">
              <button
                type="button"
                className="material-picker-footer__button"
                data-testid="material-picker-cancel"
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="material-picker-footer__button material-picker-footer__button--primary"
                data-testid="material-picker-use"
                disabled={!ui.selectedKey || busy}
                onClick={() => void handleUse()}
              >
                {busy ? "处理中…" : useButtonLabel}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {previewOpen && selected ? (
        <div
          className="material-picker-preview"
          role="dialog"
          aria-modal="true"
          data-testid="material-picker-preview"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="material-picker-preview__panel"
            onClick={stopBackdropClose}
            onMouseDown={stopBackdropClose}
          >
            <div className="material-picker-preview__media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  selected.source === "personal"
                    ? selected.asset.mediaUrl
                    : materialMediaUrl(selected.material.mediaId)
                }
                alt={
                  selected.source === "personal"
                    ? selected.asset.name
                    : selected.material.name
                }
              />
            </div>
            <div className="material-picker-preview__side">
              <h3 className="material-picker-preview__title">
                {selected.source === "personal"
                  ? selected.asset.name
                  : selected.material.name}
              </h3>
              <div className="material-picker-card__meta">
                {selected.source === "personal"
                  ? `个人空间 · ${MATERIAL_TYPE_LABELS[selected.asset.type]}`
                  : `系统素材 · ${MATERIAL_TYPE_LABELS[selected.material.type]}`}
              </div>
              {duplicateHint ? (
                <p
                  className="material-picker-preview__hint"
                  data-testid="material-picker-duplicate-hint"
                >
                  {duplicateHint}
                </p>
              ) : null}
              <div className="material-picker-footer__actions">
                <button
                  type="button"
                  className="material-picker-footer__button material-picker-footer__button--primary"
                  disabled={busy}
                  onClick={() => void handleUse()}
                >
                  {busy ? "处理中…" : useButtonLabel}
                </button>
                <button
                  type="button"
                  className="material-picker-footer__button"
                  onClick={() => setPreviewOpen(false)}
                >
                  返回
                </button>
                <button
                  type="button"
                  className="material-picker-footer__button"
                  onClick={() => {
                    clearSelection();
                    setPreviewOpen(false);
                  }}
                >
                  取消选择
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AppToastHost
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </>
  );

  if (typeof document === "undefined") return modal;

  return createPortal(modal, document.body);
}
