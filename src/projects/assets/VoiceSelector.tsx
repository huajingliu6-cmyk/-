"use client";

import { useCallback, useState } from "react";
import {
  GlassSelect,
  type GlassSelectGroup,
} from "@/shell/glass-select";
import {
  VOICE_CATALOG,
  findVoiceOption,
} from "@/projects/assets/voice-catalog";
import type { VoiceOption } from "@/projects/assets/types";

type Props = {
  value: string | null;
  onChange: (voice: VoiceOption | null) => void;
  disabled?: boolean;
  label?: string;
  /** 来自音频管理「音色」分类的项目音色 */
  projectVoices?: VoiceOption[];
  /** 外部已加载的本地音频库（可选；未传时组件自行拉取） */
  localVoices?: VoiceOption[];
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

function toOption(voice: VoiceOption) {
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
  projectVoices = [],
  localVoices: localVoicesProp,
}: Props) {
  const [fetchedLocal, setFetchedLocal] = useState<VoiceOption[]>([]);
  const [localError, setLocalError] = useState("");

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

  const groups: GlassSelectGroup[] = [
    {
      id: "local",
      label: "本地音频库",
      emptyHint: localError
        ? localError
        : "桌面「本地音频库」暂无可用音频。可将 mp3/wav/ogg 放入该文件夹后刷新。",
      options: localVoices.map(toOption),
    },
    {
      id: "project",
      label: "项目音色",
      emptyHint: "暂无项目音色。请优先从「本地音频库」选择可播放文件。",
      options: projectVoices.map(toOption),
    },
    {
      id: "system",
      label: "系统音色（占位）",
      options: VOICE_CATALOG.map(toOption),
    },
  ];

  return (
    <GlassSelect
      label={label}
      disabled={disabled}
      value={value ?? ""}
      placeholder="选择音色"
      allowClear
      clearLabel="清除绑定"
      groups={groups}
      onOpen={ensureLocalVoices}
      onChange={(id) => {
        if (!id) {
          onChange(null);
          return;
        }
        const hit =
          findVoiceOption(id, projectVoices, localVoices) ??
          null;
        onChange(hit);
      }}
    />
  );
}
