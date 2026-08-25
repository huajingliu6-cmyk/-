"use client";

import { useCallback, useState } from "react";
import {
  GlassSelect,
  type GlassSelectGroup,
} from "@/shell/glass-select";
import { AudioCreateDialog } from "@/projects/assets/AudioCreateDialog";
import { deriveAudioStatus } from "@/projects/assets/status";
import {
  deleteProjectAssetAudio,
  persistThenUploadAssetAudio,
} from "@/projects/assets/upload-asset-audio";
import {
  findVoiceOption,
  withSelectedLocalVoice,
} from "@/projects/assets/voice-catalog";
import type {
  AudioAsset,
  AudioDraftInput,
  VoiceOption,
} from "@/projects/assets/types";

const UPLOAD_VOICE_ACTION_ID = "__upload_voice__";

type Props = {
  value: string | null;
  onChange: (voice: VoiceOption | null) => void;
  disabled?: boolean;
  label?: string;
  /** Hide visible label (title shown in voice panel header instead). */
  labelHidden?: boolean;
  /** 来自音频管理「音色」分类的项目音色 */
  projectVoices?: VoiceOption[];
  /** 外部已加载的本地音频库（可选；未传时组件自行拉取） */
  localVoices?: VoiceOption[];
  /** Required for upload / hard-delete of project voices. */
  projectId?: string;
  canEdit?: boolean;
  audios?: AudioAsset[];
  onAudiosChange?: (next: AudioAsset[]) => void;
  onPersistAudios?: (next: AudioAsset[]) => Promise<void>;
  /** After hard-delete, parent may clear character voice refs locally. */
  onVoiceHardDeleted?: (voiceId: string) => void;
  onStatus?: (message: string) => void;
};

let localVoicesCache: VoiceOption[] | null = null;
let localVoicesRequest: Promise<VoiceOption[]> | null = null;

function loadLocalVoices(): Promise<VoiceOption[]> {
  if (localVoicesCache) return Promise.resolve(localVoicesCache);
  if (localVoicesRequest) return localVoicesRequest;
  localVoicesRequest = fetch("/api/local-voices", { cache: "force-cache" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`加载本地音频库失败（${res.status}）`);
      const data = (await res.json()) as { voices?: VoiceOption[] };
      localVoicesCache = Array.isArray(data.voices) ? data.voices : [];
      return localVoicesCache;
    })
    .catch((error) => {
      localVoicesRequest = null;
      throw error;
    });
  return localVoicesRequest;
}

function toProjectOption(voice: VoiceOption) {
  return {
    id: voice.id,
    label: voice.label,
    description: voice.style,
    removable: true,
  };
}

function toLocalOption(voice: VoiceOption) {
  return {
    id: voice.id,
    label: voice.label,
    description: voice.style,
  };
}

export function VoiceSelector({
  value,
  onChange,
  disabled = false,
  label = "音色选择",
  labelHidden = false,
  projectVoices = [],
  localVoices: localVoicesProp,
  projectId,
  canEdit = false,
  audios = [],
  onAudiosChange,
  onPersistAudios,
  onVoiceHardDeleted,
  onStatus,
}: Props) {
  const [fetchedLocal, setFetchedLocal] = useState<VoiceOption[]>([]);
  const [localError, setLocalError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [removingIds, setRemovingIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  const canManageProjectVoices = Boolean(
    canEdit && projectId && onAudiosChange && onPersistAudios,
  );

  const ensureLocalVoices = useCallback(() => {
    if (localVoicesProp) return;
    void loadLocalVoices()
      .then((voices) => {
        setFetchedLocal(voices);
        setLocalError("");
      })
      .catch((err) => {
        setFetchedLocal([]);
        setLocalError(
          err instanceof Error ? err.message : "加载本地音频库失败",
        );
      });
  }, [localVoicesProp]);

  const localVoices = localVoicesProp ?? fetchedLocal;
  const visibleLocalVoices = withSelectedLocalVoice(
    value,
    projectVoices,
    localVoices,
  );

  const groups: GlassSelectGroup[] = [
    {
      id: "local",
      label: "本地音频库",
      emptyHint: localError
        ? localError
        : "桌面「本地音频库」暂无可用音频。可将 mp3/wav/ogg 放入该文件夹后刷新。",
      options: visibleLocalVoices.map(toLocalOption),
    },
    {
      id: "project",
      label: "项目音色",
      emptyHint: canManageProjectVoices
        ? "暂无项目音色。可点上方「上传音色」添加。"
        : "暂无项目音色。请优先从「本地音频库」选择可播放文件。",
      options: projectVoices.map(toProjectOption),
    },
  ];

  const handleUploadSubmit = (draft: AudioDraftInput) => {
    if (!projectId || !onAudiosChange || !onPersistAudios) return;
    const pendingFile = draft.pendingAudioFile ?? null;
    if (!pendingFile) {
      setError("请选择 MP3 / WAV / OGG 音色文件");
      return;
    }
    if (draft.objectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.objectUrl);
    }
    const created: AudioAsset = {
      id: `audio_${Date.now()}`,
      projectId,
      name: draft.name,
      type: "voice",
      duration: draft.duration,
      source: draft.source || `本地上传：${pendingFile.name}`,
      fileName: null,
      objectUrl: null,
      mimeType: null,
      status: "draft",
    };
    created.status = deriveAudioStatus(created);
    const next = [...audios, created];
    setUploadOpen(false);
    setUploadBusy(true);
    setError("");
    onStatus?.("正在保存并上传音色…");
    void (async () => {
      try {
        onAudiosChange(next);
        const uploaded = await persistThenUploadAssetAudio({
          projectId,
          assetId: created.id,
          pendingFile,
          persist: () => onPersistAudios(next),
        });
        if (!uploaded) {
          throw new Error("上传音色失败：未收到文件");
        }
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
        onAudiosChange(uploadedNext);
        await onPersistAudios(uploadedNext);
        onChange({
          id: withFile.id,
          name: withFile.name,
          style: withFile.fileName
            ? `项目音色·${withFile.fileName}`
            : "项目音色",
          label: withFile.name,
          source: "project",
        });
        onStatus?.("已上传项目音色，请确认后点击「绑定音色」。");
      } catch (err: unknown) {
        // Keep persisted draft row if any; never select a failed upload.
        setError(err instanceof Error ? err.message : "上传音色失败");
        onStatus?.(err instanceof Error ? err.message : "上传音色失败");
      } finally {
        setUploadBusy(false);
      }
    })();
  };

  const handleRemoveProjectVoice = (voiceId: string) => {
    if (!projectId || !canManageProjectVoices || removingIds.includes(voiceId)) {
      return;
    }
    const ok = window.confirm(
      "确认删除该项目音色？将永久删除音频文件与资产条目，并清除所有角色对该音色的绑定。",
    );
    if (!ok) return;
    setRemovingIds((prev) => [...prev, voiceId]);
    setError("");
    onStatus?.("正在删除项目音色…");
    void (async () => {
      try {
        await deleteProjectAssetAudio(projectId, voiceId, { hard: true });
        onAudiosChange?.(audios.filter((a) => a.id !== voiceId));
        onVoiceHardDeleted?.(voiceId);
        if (value === voiceId) {
          onChange(null);
        }
        onStatus?.("已删除项目音色。");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "删除音色失败");
        onStatus?.(err instanceof Error ? err.message : "删除音色失败");
      } finally {
        setRemovingIds((prev) => prev.filter((id) => id !== voiceId));
      }
    })();
  };

  return (
    <>
      <GlassSelect
        label={label}
        hideLabel={labelHidden}
        disabled={disabled || uploadBusy}
        value={value ?? ""}
        placeholder="选择音色"
        allowClear
        clearLabel="清除绑定"
        groups={groups}
        actionOptions={
          canManageProjectVoices
            ? [{ id: UPLOAD_VOICE_ACTION_ID, label: "上传音色", action: true }]
            : undefined
        }
        onAction={(id) => {
          if (id === UPLOAD_VOICE_ACTION_ID) {
            setError("");
            setUploadOpen(true);
          }
        }}
        onRemove={
          canManageProjectVoices ? handleRemoveProjectVoice : undefined
        }
        removingIds={removingIds}
        menuPortal
        menuSideOffset={6}
        menuCollisionPadding={12}
        onOpen={ensureLocalVoices}
        onChange={(id) => {
          if (!id) {
            onChange(null);
            return;
          }
          const hit =
            findVoiceOption(id, projectVoices, visibleLocalVoices) ?? null;
          onChange(hit);
        }}
      />
      {error ? <p className="amw-field-error">{error}</p> : null}
      {canManageProjectVoices ? (
        <AudioCreateDialog
          open={uploadOpen}
          fixedType="voice"
          submitLabel="上传音色"
          onClose={() => setUploadOpen(false)}
          onSubmit={handleUploadSubmit}
        />
      ) : null}
    </>
  );
}
