"use client";

import { useMemo, useRef, useState } from "react";
import { VoiceGeneratePanel } from "@/projects/assets/VoiceGeneratePanel";
import { VoicePickerPanel } from "@/projects/assets/VoicePickerPanel";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";
import { deriveAudioStatus } from "@/projects/assets/status";
import { SYSTEM_VOICE_CATALOG } from "@/projects/assets/system-voice-catalog";
import { persistThenUploadAssetAudio } from "@/projects/assets/upload-asset-audio";
import {
  formatVoiceDurationLabel,
  readVoiceAudioDurationSeconds,
  validateVoiceAudioFileClient,
} from "@/projects/assets/voice-audio-validation";
import { voiceOptionsFromAudios } from "@/projects/assets/voice-catalog";
import type { AudioAsset, VoiceOption } from "@/projects/assets/types";

type Props = {
  projectId: string;
  canEdit: boolean;
  contextLabel: string;
  scopeLabel: string;
  displayedVoiceId: string | null;
  displayedVoiceName: string | null;
  pendingVoice: VoiceOption | null;
  onPendingVoiceChange: (voice: VoiceOption | null) => void;
  voiceBoundCurrent: boolean;
  voiceSelectionDirty: boolean;
  projectVoices?: VoiceOption[];
  audios?: AudioAsset[];
  onAudiosChange?: (next: AudioAsset[]) => void;
  onPersistAudios?: (next: AudioAsset[]) => Promise<void>;
  onBind: () => void;
  bindBusy?: boolean;
  onStatus?: (message: string) => void;
  characterId?: string;
  voiceScope?: string;
  visualContext?: string;
};

export function CharacterVoiceSettings({
  projectId,
  canEdit,
  contextLabel,
  scopeLabel,
  displayedVoiceId,
  displayedVoiceName,
  pendingVoice,
  onPendingVoiceChange,
  voiceBoundCurrent,
  voiceSelectionDirty,
  projectVoices = [],
  audios = [],
  onAudiosChange,
  onPersistAudios,
  onBind,
  bindBusy = false,
  onStatus,
  characterId,
  voiceScope,
  visualContext,
}: Props) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selectBtnRef = useRef<HTMLButtonElement>(null);
  const generateBtnRef = useRef<HTMLButtonElement>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMeta, setUploadMeta] = useState<{
    fileName: string;
    duration: string;
  } | null>(null);

  const catalogProjectVoices = useMemo(
    () => voiceOptionsFromAudios(audios),
    [audios],
  );

  const allPickerVoices = useMemo(() => {
    const byId = new Map<string, VoiceOption>();
    for (const voice of SYSTEM_VOICE_CATALOG) {
      byId.set(voice.id, voice);
    }
    for (const voice of catalogProjectVoices) {
      byId.set(voice.id, voice);
    }
    for (const voice of projectVoices) {
      if (!byId.has(voice.id)) byId.set(voice.id, voice);
    }
    return [...byId.values()];
  }, [catalogProjectVoices, projectVoices]);

  const statusText = (() => {
    if (pendingVoice?.status === "processing") return "音色处理中";
    if (pendingVoice?.status === "failed") return "音色生成失败";
    if (voiceSelectionDirty && pendingVoice) {
      return `已选择：${pendingVoice.name || pendingVoice.label}`;
    }
    if (voiceBoundCurrent && displayedVoiceName) {
      return `已绑定：${displayedVoiceName}`;
    }
    if (displayedVoiceId && !voiceSelectionDirty) {
      return displayedVoiceName
        ? `已绑定：${displayedVoiceName}`
        : "已绑定音色";
    }
    return "未绑定音色";
  })();

  const canManageUpload = Boolean(
    canEdit && projectId && onAudiosChange && onPersistAudios,
  );

  const handleQuickUpload = async (file: File) => {
    if (!canManageUpload) return;
    setUploadError("");
    const validationError = await validateVoiceAudioFileClient(file);
    if (validationError) {
      setUploadError(validationError);
      onStatus?.(validationError);
      return;
    }
    const durationSeconds = await readVoiceAudioDurationSeconds(file);
    const durationLabel = durationSeconds
      ? formatVoiceDurationLabel(durationSeconds)
      : "";
    setUploadMeta({ fileName: file.name, duration: durationLabel });

    const created: AudioAsset = {
      id: `audio_${Date.now()}`,
      projectId,
      name: file.name.replace(/\.[^.]+$/, "") || file.name,
      type: "voice",
      duration: durationLabel,
      source: `本地上传：${file.name}`,
      fileName: null,
      objectUrl: null,
      mimeType: null,
      status: "draft",
    };
    created.status = deriveAudioStatus(created);
    const next = [...audios, created];
    setUploadBusy(true);
    onStatus?.("正在保存并上传音色…");
    void (async () => {
      try {
        onAudiosChange!(next);
        const uploaded = await persistThenUploadAssetAudio({
          projectId,
          assetId: created.id,
          pendingFile: file,
          persist: () => onPersistAudios!(next),
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
        onAudiosChange!(uploadedNext);
        await onPersistAudios!(uploadedNext);
        onPendingVoiceChange({
          id: withFile.id,
          name: withFile.name,
          style: withFile.fileName
            ? `项目音色·${withFile.fileName}`
            : "项目音色",
          label: withFile.name,
          source: "project",
          status: "ready",
        });
        onStatus?.("已上传项目音色，请试听并点击「绑定音色」。");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "上传音色失败";
        setUploadError(message);
        onStatus?.(message);
      } finally {
        setUploadBusy(false);
      }
    })();
  };

  return (
    <section
      className="character-voice-bar"
      data-testid="character-voice-card"
      data-scope={voiceScope}
      data-visual-context={visualContext}
    >
      <div className="character-voice-bar__context">
        <strong>音色设置</strong>
        <span data-testid="character-voice-context">{contextLabel}</span>
        <span
          className="character-voice-bar__badge"
          data-testid="character-voice-scope-label"
        >
          {scopeLabel}
        </span>
      </div>

      <p
        className="character-voice-bar__status"
        data-testid="character-voice-status"
      >
        {statusText}
      </p>

      {uploadMeta ? (
        <div className="character-voice-meta" data-testid="character-voice-meta">
          <div>
            <dt>文件</dt>
            <dd>{uploadMeta.fileName}</dd>
          </div>
          {uploadMeta.duration ? (
            <div>
              <dt>时长</dt>
              <dd>{uploadMeta.duration}</dd>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="character-voice-bar__controls character-voice-bar__actions">
        <input
          ref={uploadInputRef}
          type="file"
          accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
          hidden
          data-testid="character-voice-upload-input"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            if (file) void handleQuickUpload(file);
          }}
        />
        <button
          type="button"
          className="amw-btn character-voice-bar__action"
          data-testid="character-voice-upload"
          disabled={!canEdit || uploadBusy || !canManageUpload}
          onClick={() => uploadInputRef.current?.click()}
        >
          {uploadBusy ? "上传中…" : "上传音色"}
        </button>
        <button
          ref={selectBtnRef}
          type="button"
          className="amw-btn character-voice-bar__action"
          data-testid="character-voice-select"
          disabled={!canEdit}
          aria-expanded={pickerOpen}
          onClick={() => {
            setGenerateOpen(false);
            setPickerOpen((open) => !open);
          }}
        >
          选择音色
        </button>
        <button
          ref={generateBtnRef}
          type="button"
          className="amw-btn amw-btn-primary character-voice-bar__action character-voice-bar__action--generate"
          data-testid="character-voice-generate"
          disabled={!canEdit}
          aria-expanded={generateOpen}
          onClick={() => {
            setPickerOpen(false);
            setGenerateOpen((open) => !open);
          }}
        >
          生成音色
        </button>

        <VoicePreviewButton
          projectId={projectId}
          voiceId={displayedVoiceId}
          audios={audios}
          disabled={!displayedVoiceId}
          toggle
          testId="character-voice-preview"
        />

        <button
          type="button"
          className={`amw-btn character-voice-bar__bind${
            voiceBoundCurrent && !voiceSelectionDirty ? " is-bound" : " amw-btn-primary"
          }`}
          data-testid="character-voice-bind"
          disabled={
            !canEdit ||
            bindBusy ||
            !displayedVoiceId ||
            (voiceBoundCurrent && !voiceSelectionDirty)
          }
          onClick={onBind}
        >
          {bindBusy
            ? "绑定中…"
            : voiceBoundCurrent && !voiceSelectionDirty
              ? "已绑定"
              : "绑定音色"}
        </button>
      </div>

      {uploadError ? <p className="amw-field-error">{uploadError}</p> : null}

      <VoicePickerPanel
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={selectBtnRef}
        voices={allPickerVoices}
        selectedId={displayedVoiceId}
        audios={audios}
        projectId={projectId}
        onSelect={(voice) => {
          onPendingVoiceChange(voice);
          onStatus?.(`已选择「${voice.label || voice.name}」，请试听并绑定。`);
        }}
      />

      <VoiceGeneratePanel
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        anchorRef={generateBtnRef}
        projectId={projectId}
        characterId={characterId}
        onGeneratedSelect={(voice) => {
          onPendingVoiceChange(voice);
          onStatus?.(`已生成「${voice.name}」（Mock），请绑定到当前角色。`);
        }}
        onStatus={onStatus}
      />
    </section>
  );
}
