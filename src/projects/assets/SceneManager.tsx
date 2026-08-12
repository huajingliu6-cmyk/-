"use client";

import { useState } from "react";
import { MapPinned } from "lucide-react";
import { AssetBasicInfo } from "@/projects/assets/AssetBasicInfo";
import {
  AssetCompactList,
  AssetListPanelHeader,
} from "@/projects/assets/AssetCompactList";
import { AssetDetailImage } from "@/projects/assets/AssetDetailImage";
import { AssetDetailLayout } from "@/projects/assets/AssetDetailLayout";
import { AssetImageUpload } from "@/projects/assets/AssetImageUpload";
import { AssetLibraryLayout } from "@/projects/assets/AssetLibraryLayout";
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

  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  const updateOne = (next: SceneAsset) => {
    const withStatus = { ...next, status: deriveSceneStatus(next) };
    onChange(scenes.map((s) => (s.id === withStatus.id ? withStatus : s)));
  };

  const previewSrc = selected
    ? resolveAssetImageSrc(projectId, selected, {
        revision: imageRevisions[selected.id] ?? 0,
      })
    : null;

  return (
    <>
      <AssetLibraryLayout
        listLabel="场景列表"
        listHeader={
          <AssetListPanelHeader
            title="场景列表"
            action={
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={!canEdit}
                onClick={() => setCreateOpen(true)}
              >
                + 新建场景
              </button>
            }
          />
        }
        list={
          <AssetCompactList
            projectId={projectId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="暂无场景资产。"
            testId="scene-compact-list"
            items={scenes.map((s) => {
              const status = sceneDisplayStatus(s);
              return {
                id: s.id,
                name: s.name || "未命名场景",
                status,
                warn: status === "待完善" || status === "草稿",
                placeholder: s.name.trim().slice(0, 1) || "景",
                asset: s,
                revision: imageRevisions[s.id] ?? 0,
              };
            })}
          />
        }
        details={
          <AssetDetailLayout
            title="场景详情"
            aria-label="场景详情"
            className="scene-detail"
            empty={!selected}
            emptyMessage="选择或新建场景以编辑详情。"
            status={
              selected ? (
                <span className="amw-badge">
                  {sceneDisplayStatus(selected)}
                </span>
              ) : null
            }
            preview={
              selected ? (
                <AssetDetailImage
                  fill
                  src={previewSrc}
                  alt={selected.imageFileName ?? selected.name}
                  testId="scene-detail-image"
                  emptyIcon={<MapPinned size={36} strokeWidth={1.5} />}
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
                      key: "sceneType",
                      label: "类型",
                      value: selected.sceneType,
                      disabled: !canEdit,
                      placeholder: "如：室内 / 外景",
                      onChange: (v) =>
                        updateOne({ ...selected, sceneType: v }),
                    },
                    {
                      key: "timeOfDay",
                      label: "时间",
                      value: selected.timeOfDay,
                      disabled: !canEdit,
                      onChange: (v) =>
                        updateOne({ ...selected, timeOfDay: v }),
                    },
                    {
                      key: "location",
                      label: "位置",
                      value: selected.location,
                      disabled: !canEdit,
                      onChange: (v) =>
                        updateOne({ ...selected, location: v }),
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
                  id={`scene-image-${selected.id}`}
                  label="场景图片"
                  compact
                  replaceOnly
                  hidePreview
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
              ) : null
            }
            footer={note ? <p className="amw-note">{note}</p> : null}
          />
        }
      />

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
