"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AmwImagePreview } from "@/projects/assets/AmwImagePreview";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { AssetListThumb } from "@/projects/assets/AssetListThumb";
import { PropCreateDialog } from "@/projects/assets/PropCreateDialog";
import { derivePropStatus, propDisplayStatus } from "@/projects/assets/status";
import { resolveAssetImageSrc } from "@/projects/assets/asset-image-url";
import { persistThenUploadAssetImage } from "@/projects/assets/upload-asset-image";
import type { PropAsset, PropDraftInput } from "@/projects/assets/types";

type Props = {
  projectId: string;
  props: PropAsset[];
  canEdit: boolean;
  onChange: (next: PropAsset[]) => void;
  onPersist: (next: PropAsset[]) => Promise<void>;
};

export function PropManager({
  projectId,
  props: propItems,
  canEdit,
  onChange,
  onPersist,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    propItems[0]?.id ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>(
    {},
  );
  const saveBounce = useChipBounce();
  const selected = propItems.find((p) => p.id === selectedId) ?? null;

  const updateOne = (next: PropAsset) => {
    const withStatus = { ...next, status: derivePropStatus(next) };
    onChange(propItems.map((p) => (p.id === withStatus.id ? withStatus : p)));
  };

  const handleSave = () => {
    if (!selected) return;
    const nextItem = {
      ...selected,
      status: derivePropStatus(selected),
    };
    const next = propItems.map((p) =>
      p.id === nextItem.id ? nextItem : p,
    );
    onChange(next);
    setNote("正在保存道具…");
    void onPersist(next)
      .then(() => setNote("已保存道具到服务器。"))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "保存失败");
      });
  };

  const handleCreate = (draft: PropDraftInput) => {
    const pendingFile = draft.pendingImageFile ?? null;
    if (draft.imageObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.imageObjectUrl);
    }
    const created: PropAsset = {
      id: `prop_${Date.now()}`,
      projectId,
      name: draft.name,
      propType: "",
      usage: "",
      description: draft.description,
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft",
    };
    created.status = derivePropStatus(created);
    const next = [...propItems, created];
    onChange(next);
    setSelectedId(created.id);
    setCreateOpen(false);
    setNote("已创建道具，正在保存…");
    void (async () => {
      try {
        const uploaded = await persistThenUploadAssetImage({
          projectId,
          assetId: created.id,
          pendingFile,
          persist: () => onPersist(next),
        });
        if (uploaded) {
          const withImage: PropAsset = {
            ...created,
            imageFileName: uploaded.imageFileName,
            imageMimeType: uploaded.imageMimeType,
            imageObjectUrl: null,
            status: derivePropStatus({
              ...created,
              imageFileName: uploaded.imageFileName,
              imageObjectUrl: null,
            }),
          };
          const uploadedNext = next.map((p) =>
            p.id === created.id ? withImage : p,
          );
          onChange(uploadedNext);
          setImageRevisions((prev) => ({
            ...prev,
            [created.id]: (prev[created.id] ?? 0) + 1,
          }));
          await onPersist(uploadedNext);
          setNote("已创建并保存道具图片。");
        } else {
          setNote("已创建并保存道具。");
        }
      } catch (err: unknown) {
        setNote(err instanceof Error ? err.message : "保存失败");
      }
    })();
  };

  const previewSrc = selected
    ? resolveAssetImageSrc(projectId, selected, {
        revision: imageRevisions[selected.id] ?? 0,
      })
    : null;

  return (
    <>
      <div className="amw-layout">
        <section className="amw-panel" aria-label="道具列表">
          <div className="amw-panel__head">
            <h2>道具列表</h2>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              disabled={!canEdit}
              onClick={() => setCreateOpen(true)}
            >
              + 新建道具
            </button>
          </div>
          <div className="amw-panel__body">
            {propItems.length === 0 ? (
              <div className="amw-empty">暂无道具资产。</div>
            ) : (
              <div className="amw-list">
                {propItems.map((p, index) => {
                  const status = propDisplayStatus(p);
                  const warn = status === "待完善" || status === "草稿";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`amw-card asset-card${selectedId === p.id ? " is-selected" : ""}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <span className="amw-avatar asset-card__media" aria-hidden>
                        <AssetListThumb
                          projectId={projectId}
                          asset={p}
                          placeholder={p.name.trim().slice(0, 1) || "道"}
                          revision={imageRevisions[p.id] ?? 0}
                          fit="contain"
                        />
                      </span>
                      <span className="amw-card__meta asset-card__content">
                        <span className="asset-card__header">
                          <p className="amw-card__title">{p.name}</p>
                          <span
                            className={`amw-badge${warn ? " is-warn" : " is-ok"}`}
                          >
                            {status}
                          </span>
                        </span>
                        <p className="amw-card__sub asset-card__meta-line">
                          道具
                          {p.propType ? ` · ${p.propType}` : ""}
                        </p>
                        <p className="amw-card__sub asset-card__note">
                          {p.usage?.trim() || "暂无备注"}
                        </p>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="amw-panel" aria-label="道具详情">
          <div className="amw-panel__head">
            <h2>道具详情</h2>
            {selected ? (
              <span className="amw-badge">{propDisplayStatus(selected)}</span>
            ) : null}
          </div>
          <div className="amw-panel__body">
            {!selected ? (
              <div className="amw-empty">选择或新建道具以编辑详情。</div>
            ) : (
              <div className="amw-detail">
                {previewSrc ? (
                  <AmwImagePreview
                    className="amw-image-preview--detail"
                    src={previewSrc}
                    alt={selected.imageFileName ?? selected.name}
                  />
                ) : null}
                <div className="amw-fields">
                  <SimpleField
                    label="道具名称"
                    value={selected.name}
                    disabled={!canEdit}
                    onChange={(v) => updateOne({ ...selected, name: v })}
                  />
                </div>
                <AssetImageUpload
                  id={`prop-image-${selected.id}`}
                  label="上传道具图片"
                  disabled={!canEdit}
                  projectId={projectId}
                  assetId={selected.id}
                  ensurePersisted={async () => {
                    await onPersist(propItems);
                  }}
                  revision={imageRevisions[selected.id] ?? 0}
                  onRevisionChange={(next) =>
                    setImageRevisions((prev) => ({
                      ...prev,
                      [selected.id]: next,
                    }))
                  }
                  value={{
                    fileName: selected.imageFileName,
                    objectUrl: selected.imageObjectUrl,
                    mimeType: selected.imageMimeType,
                  }}
                  onChange={(image) =>
                    updateOne({
                      ...selected,
                      imageFileName: image.fileName,
                      imageObjectUrl: image.objectUrl,
                      imageMimeType: image.mimeType,
                    })
                  }
                />
                <div className="amw-actions">
                  <button
                    type="button"
                    className={`amw-btn amw-btn-primary ${saveBounce.bounceClass}`}
                    disabled={!canEdit || !selected.name.trim()}
                    onClick={() => {
                      saveBounce.trigger();
                      handleSave();
                    }}
                    onAnimationEnd={saveBounce.onAnimationEnd}
                  >
                    保存
                  </button>
                </div>
                {note ? <p className="amw-note">{note}</p> : null}
              </div>
            )}
          </div>
        </section>
      </div>

      <PropCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}

function SimpleField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="amw-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="amw-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
