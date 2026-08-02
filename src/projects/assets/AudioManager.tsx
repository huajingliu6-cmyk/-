"use client";

import { useState } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import { GlassSelect } from "@/shell/glass-select";
import { AudioCreateDialog } from "@/projects/assets/AudioCreateDialog";
import {
  audioDisplayStatus,
  deriveAudioStatus,
} from "@/projects/assets/status";
import type {
  AudioAsset,
  AudioAssetKind,
  AudioDraftInput,
} from "@/projects/assets/types";
import {
  AssetAudioUpload,
  type AssetAudioValue,
} from "@/projects/assets/AssetAudioUpload";
import { AssetAudioPlayer } from "@/projects/assets/AssetAudioPlayer";
import { persistThenUploadAssetAudio } from "@/projects/assets/upload-asset-audio";

type Props = {
  projectId: string;
  audios: AudioAsset[];
  canEdit: boolean;
  onChange: (next: AudioAsset[]) => void;
  onPersist: (next: AudioAsset[]) => Promise<void>;
};

const AUDIO_TYPE_OPTIONS = [
  { id: "voice", label: "音色" },
  { id: "music", label: "音乐" },
  { id: "sfx", label: "音效" },
  { id: "narration", label: "旁白" },
] as const;

const TYPE_LABEL: Record<AudioAssetKind, string> = {
  voice: "音色",
  music: "音乐",
  sfx: "音效",
  narration: "旁白",
};

export function AudioManager({
  projectId,
  audios,
  canEdit,
  onChange,
  onPersist,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    audios[0]?.id ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [audioRevision, setAudioRevision] = useState(0);
  const saveBounce = useChipBounce();
  const selected = audios.find((a) => a.id === selectedId) ?? null;

  const updateOne = (next: AudioAsset) => {
    const withStatus = { ...next, status: deriveAudioStatus(next) };
    onChange(audios.map((a) => (a.id === withStatus.id ? withStatus : a)));
  };

  const handleSave = () => {
    if (!selected) return;
    const nextItem = {
      ...selected,
      status: deriveAudioStatus(selected),
    };
    const next = audios.map((a) => (a.id === nextItem.id ? nextItem : a));
    onChange(next);
    setNote("正在保存音频…");
    void onPersist(next)
      .then(() => setNote("已保存音频到服务器。"))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "保存失败");
      });
  };

  const handleCreate = (draft: AudioDraftInput) => {
    const pendingFile = draft.pendingAudioFile ?? null;
    if (draft.objectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.objectUrl);
    }
    const created: AudioAsset = {
      id: `audio_${Date.now()}`,
      projectId,
      name: draft.name,
      type: draft.type,
      duration: draft.duration,
      source: draft.source,
      fileName: null,
      objectUrl: null,
      mimeType: null,
      status: "draft",
    };
    created.status = deriveAudioStatus(created);
    const next = [...audios, created];
    onChange(next);
    setSelectedId(created.id);
    setCreateOpen(false);
    setNote("已创建音频，正在保存并上传…");
    void (async () => {
      try {
        const uploaded = await persistThenUploadAssetAudio({
          projectId,
          assetId: created.id,
          pendingFile,
          persist: () => onPersist(next),
        });
        if (uploaded) {
          const withFile: AudioAsset = {
            ...created,
            fileName: uploaded.fileName,
            mimeType: uploaded.mimeType,
            objectUrl: null,
            status: deriveAudioStatus({
              ...created,
              fileName: uploaded.fileName,
            }),
          };
          const uploadedNext = next.map((a) =>
            a.id === created.id ? withFile : a,
          );
          onChange(uploadedNext);
          setAudioRevision((r) => r + 1);
          await onPersist(uploadedNext);
          setNote(
            draft.type === "voice"
              ? "已创建并上传项目音色。"
              : "已创建并上传音频。",
          );
        } else {
          setNote(
            draft.type === "voice"
              ? "已创建并保存项目音色（未上传文件）。"
              : "已创建并保存音频条目。",
          );
        }
      } catch (err: unknown) {
        setNote(err instanceof Error ? err.message : "保存或上传失败");
      }
    })();
  };

  return (
    <>
      <div className="amw-layout">
        <section className="amw-panel" aria-label="音频列表">
          <div className="amw-panel__head">
            <h2>音频列表</h2>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              disabled={!canEdit}
              onClick={() => setCreateOpen(true)}
            >
              + 新建音频
            </button>
          </div>
          <div className="amw-panel__body">
            {audios.length === 0 ? (
              <div className="amw-empty">
                管理音色、背景音乐、环境音与旁白。可上传自定义音色供角色绑定。
              </div>
            ) : (
              <div className="amw-list">
                {audios.map((a, index) => {
                  const status = audioDisplayStatus(a);
                  const warn = status === "待完善" || status === "草稿";
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`amw-card${selectedId === a.id ? " is-selected" : ""}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                      onClick={() => setSelectedId(a.id)}
                    >
                      <span className="amw-avatar" aria-hidden>
                        {TYPE_LABEL[a.type].slice(0, 1)}
                      </span>
                      <span className="amw-card__meta">
                        <p className="amw-card__title">{a.name}</p>
                        <p className="amw-card__sub">
                          {TYPE_LABEL[a.type]}
                          {a.duration ? ` · ${a.duration}` : ""}
                          {a.fileName ? ` · ${a.fileName}` : ""}
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

        <section className="amw-panel" aria-label="音频详情">
          <div className="amw-panel__head">
            <h2>音频详情</h2>
            {selected ? (
              <span className="amw-badge">{audioDisplayStatus(selected)}</span>
            ) : null}
          </div>
          <div className="amw-panel__body">
            {!selected ? (
              <div className="amw-empty">选择音频资产查看详情。</div>
            ) : (
              <div className="amw-detail">
                <div className="amw-fields">
                  <div className="amw-field">
                    <label>名称</label>
                    <input
                      className="amw-input"
                      value={selected.name}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updateOne({ ...selected, name: e.target.value })
                      }
                    />
                  </div>
                  <GlassSelect
                    label="类型"
                    disabled={!canEdit}
                    value={selected.type}
                    options={[...AUDIO_TYPE_OPTIONS]}
                    onChange={(id) =>
                      updateOne({
                        ...selected,
                        type: id as AudioAssetKind,
                      })
                    }
                  />
                  <div className="amw-field">
                    <label>时长</label>
                    <input
                      className="amw-input"
                      value={selected.duration}
                      disabled={!canEdit}
                      placeholder="如 02:40"
                      onChange={(e) =>
                        updateOne({ ...selected, duration: e.target.value })
                      }
                    />
                  </div>
                  <div className="amw-field">
                    <label>来源</label>
                    <input
                      className="amw-input"
                      value={selected.source}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updateOne({ ...selected, source: e.target.value })
                      }
                    />
                  </div>
                </div>
                <AssetAudioUpload
                  id={`audio-file-${selected.id}`}
                  label="音频文件"
                  tip="支持 MP3 / WAV / OGG，最大 50MB。上传后刷新仍可播放。"
                  projectId={projectId}
                  assetId={selected.id}
                  disabled={!canEdit}
                  revision={audioRevision}
                  onRevisionChange={setAudioRevision}
                  value={{
                    fileName: selected.fileName,
                    objectUrl: selected.objectUrl,
                    mimeType: selected.mimeType,
                  }}
                  ensurePersisted={async () => {
                    const nextItem = {
                      ...selected,
                      status: deriveAudioStatus(selected),
                    };
                    const next = audios.map((a) =>
                      a.id === nextItem.id ? nextItem : a,
                    );
                    onChange(next);
                    await onPersist(next);
                  }}
                  onChange={(image: AssetAudioValue) => {
                    updateOne({
                      ...selected,
                      fileName: image.fileName,
                      objectUrl: image.objectUrl,
                      mimeType: image.mimeType,
                    });
                  }}
                  onDurationRead={(label) => {
                    if (label && !selected.duration) {
                      updateOne({ ...selected, duration: label });
                    }
                  }}
                  showPlayer={false}
                />
                <AssetAudioPlayer
                  projectId={projectId}
                  assetId={selected.id}
                  fileName={selected.fileName}
                  objectUrl={selected.objectUrl}
                  revision={audioRevision}
                  onError={() => {
                    setNote(
                      "音频文件不可用（可能尚未落盘）。可重新上传。",
                    );
                  }}
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

      <AudioCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}
