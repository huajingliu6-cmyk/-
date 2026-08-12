"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { AssetBasicInfo } from "@/projects/assets/AssetBasicInfo";
import {
  AssetCompactList,
  AssetListPanelHeader,
} from "@/projects/assets/AssetCompactList";
import { AssetDetailImage } from "@/projects/assets/AssetDetailImage";
import { AssetDetailLayout } from "@/projects/assets/AssetDetailLayout";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
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
  const selected = propItems.find((p) => p.id === selectedId) ?? null;

  const updateOne = (next: PropAsset) => {
    const withStatus = { ...next, status: derivePropStatus(next) };
    onChange(propItems.map((p) => (p.id === withStatus.id ? withStatus : p)));
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
      <AssetLibraryLayout
        listLabel="道具列表"
        listHeader={
          <AssetListPanelHeader
            title="道具列表"
            action={
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={!canEdit}
                onClick={() => setCreateOpen(true)}
              >
                + 新建道具
              </button>
            }
          />
        }
        list={
          <AssetCompactList
            projectId={projectId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="暂无道具资产。"
            testId="prop-compact-list"
            items={propItems.map((p) => {
              const status = propDisplayStatus(p);
              return {
                id: p.id,
                name: p.name || "未命名道具",
                status,
                warn: status === "待完善" || status === "草稿",
                placeholder: p.name.trim().slice(0, 1) || "道",
                asset: p,
                revision: imageRevisions[p.id] ?? 0,
              };
            })}
          />
        }
        details={
          <AssetDetailLayout
            title="道具详情"
            aria-label="道具详情"
            className="prop-detail"
            empty={!selected}
            emptyMessage="选择或新建道具以编辑详情。"
            status={
              selected ? (
                <span className="amw-badge">{propDisplayStatus(selected)}</span>
              ) : null
            }
            preview={
              selected ? (
                <AssetDetailImage
                  fill
                  src={previewSrc}
                  alt={selected.imageFileName ?? selected.name}
                  testId="prop-detail-image"
                  emptyIcon={<Package size={36} strokeWidth={1.5} />}
                />
              ) : null
            }
            basicInfo={
              selected ? (
                <AssetBasicInfo
                  compact
                  fields={[
                    {
                      key: "name",
                      label: (
                        <>
                          名称<span className="req">*</span>
                        </>
                      ),
                      value: selected.name,
                      disabled: !canEdit,
                      onChange: (v) => updateOne({ ...selected, name: v }),
                    },
                    {
                      key: "propType",
                      label: "类型",
                      value: selected.propType,
                      disabled: !canEdit,
                      placeholder: "如：武器 / 信物",
                      onChange: (v) =>
                        updateOne({ ...selected, propType: v }),
                    },
                    {
                      key: "usage",
                      label: "用途",
                      value: selected.usage,
                      disabled: !canEdit,
                      onChange: (v) => updateOne({ ...selected, usage: v }),
                    },
                  ]}
                />
              ) : null
            }
            notes={
              selected ? (
                <div className="amw-field amw-field--notes-compact">
                  <label>备注</label>
                  <textarea
                    className="amw-textarea asset-controls__notes-textarea"
                    value={selected.description}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateOne({
                        ...selected,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              ) : null
            }
            previewOverlayActions={
              selected ? (
                <AssetImageUpload
                  id={`prop-image-${selected.id}`}
                  label="上传道具图片"
                  compact
                  replaceOnly
                  hidePreview
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
              ) : null
            }
            footer={note ? <p className="amw-note">{note}</p> : null}
          />
        }
      />

      <PropCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}
