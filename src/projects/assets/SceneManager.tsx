"use client";

import { useId, useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AmwImagePreview } from "@/projects/assets/AmwImagePreview";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { AssetListThumb } from "@/projects/assets/AssetListThumb";
import { SceneCreateDialog } from "@/projects/assets/SceneCreateDialog";
import { deriveSceneStatus, sceneDisplayStatus } from "@/projects/assets/status";
import { resolveAssetImageSrc } from "@/projects/assets/asset-image-url";
import { persistThenUploadAssetImage } from "@/projects/assets/upload-asset-image";
import type { SceneAsset } from "@/projects/assets/types";

type Props = {
  projectId: string;
  scenes: SceneAsset[];
  canEdit: boolean;
  onChange: (next: SceneAsset[]) => void;
  onPersist: (next: SceneAsset[]) => Promise<void>;
};

export function SceneManager({
  projectId,
  scenes,
  canEdit,
  onChange,
  onPersist,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    scenes[0]?.id ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>(
    {},
  );
  const saveBounce = useChipBounce();

  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  const updateOne = (next: SceneAsset) => {
    const withStatus = { ...next, status: deriveSceneStatus(next) };
    onChange(scenes.map((s) => (s.id === withStatus.id ? withStatus : s)));
  };

  const handleSave = () => {
    if (!selected) return;
    const nextItem = { ...selected, status: deriveSceneStatus(selected) };
    const next = scenes.map((s) => (s.id === nextItem.id ? nextItem : s));
    onChange(next);
    setNote("正在保存场景…");
    void onPersist(next)
      .then(() => setNote("已保存场景到服务器。"))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "保存失败");
      });
  };

  const previewSrc = selected
    ? resolveAssetImageSrc(projectId, selected, {
        revision: imageRevisions[selected.id] ?? 0,
      })
    : null;

  return (
    <>
      <div className="amw-layout">
        <section className="amw-panel" aria-label="场景列表">
          <div className="amw-panel__head">
            <h2>场景列表</h2>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              disabled={!canEdit}
              onClick={() => setCreateOpen(true)}
            >
              + 新建场景
            </button>
          </div>
          <div className="amw-panel__body">
            {scenes.length === 0 ? (
              <div className="amw-empty">暂无场景资产。</div>
            ) : (
              <div className="amw-list">
                {scenes.map((s, index) => {
                  const status = sceneDisplayStatus(s);
                  const warn = status === "待完善" || status === "草稿";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`amw-card${selectedId === s.id ? " is-selected" : ""}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <span className="amw-avatar" aria-hidden>
                        <AssetListThumb
                          projectId={projectId}
                          asset={s}
                          placeholder={s.name.trim().slice(0, 1) || "景"}
                          revision={imageRevisions[s.id] ?? 0}
                        />
                      </span>
                      <span className="amw-card__meta">
                        <p className="amw-card__title">{s.name}</p>
                        <p className="amw-card__sub">
                          {[s.timeOfDay, s.imageFileName ? "已上传图片" : ""]
                            .filter(Boolean)
                            .join(" · ") || "未完善设定"}
                        </p>
                      </span>
                      <span
                        className={`amw-badge${warn ? " is-warn" : " is-ok"}`}
                      >
                        {status}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="amw-panel" aria-label="场景详情">
          <div className="amw-panel__head">
            <h2>场景详情</h2>
            {selected ? (
              <span className="amw-badge">{sceneDisplayStatus(selected)}</span>
            ) : null}
          </div>
          <div className="amw-panel__body">
            {!selected ? (
              <div className="amw-empty">选择或新建场景以编辑详情。</div>
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
                  <Field
                    label="场景名称"
                    value={selected.name}
                    disabled={!canEdit}
                    onChange={(v) => updateOne({ ...selected, name: v })}
                  />
                  <Field
                    label="时间"
                    value={selected.timeOfDay}
                    disabled={!canEdit}
                    onChange={(v) => updateOne({ ...selected, timeOfDay: v })}
                  />
                </div>
                <div className="amw-field">
                  <label>场景描述</label>
                  <textarea
                    className="amw-textarea"
                    value={selected.description}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateOne({ ...selected, description: e.target.value })
                    }
                  />
                </div>
                <AssetImageUpload
                  id={`scene-image-${selected.id}`}
                  label="场景图片"
                  disabled={!canEdit}
                  projectId={projectId}
                  assetId={selected.id}
                  ensurePersisted={async () => {
                    await onPersist(scenes);
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

      <SceneCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(draft) => {
          const pendingFile = draft.pendingImageFile ?? null;
          if (draft.imageObjectUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(draft.imageObjectUrl);
          }
          const created: SceneAsset = {
            id: `scene_${Date.now()}`,
            projectId,
            name: draft.name,
            sceneType: "",
            description: draft.description,
            timeOfDay: draft.timeOfDay,
            location: "",
            style: "",
            imageFileName: null,
            imageObjectUrl: null,
            imageMimeType: null,
            status: "draft",
          };
          created.status = deriveSceneStatus(created);
          const next = [...scenes, created];
          onChange(next);
          setSelectedId(created.id);
          setCreateOpen(false);
          setNote("已创建场景，正在保存…");
          void (async () => {
            try {
              const uploaded = await persistThenUploadAssetImage({
                projectId,
                assetId: created.id,
                pendingFile,
                persist: () => onPersist(next),
              });
              if (uploaded) {
                const withImage: SceneAsset = {
                  ...created,
                  imageFileName: uploaded.imageFileName,
                  imageMimeType: uploaded.imageMimeType,
                  imageObjectUrl: null,
                  status: deriveSceneStatus({
                    ...created,
                    imageFileName: uploaded.imageFileName,
                    imageObjectUrl: null,
                  }),
                };
                const uploadedNext = next.map((s) =>
                  s.id === created.id ? withImage : s,
                );
                onChange(uploadedNext);
                setImageRevisions((prev) => ({
                  ...prev,
                  [created.id]: (prev[created.id] ?? 0) + 1,
                }));
                await onPersist(uploadedNext);
                setNote("已创建并保存场景图片。");
              } else {
                setNote("已创建并保存场景。");
              }
            } catch (err: unknown) {
              setNote(err instanceof Error ? err.message : "保存失败");
            }
          })();
        }}
      />
    </>
  );
}

function Field({
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
