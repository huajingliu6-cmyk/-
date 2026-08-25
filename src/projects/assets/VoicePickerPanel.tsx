"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { VoiceAnchorPanel } from "@/projects/assets/VoiceAnchorPanel";
import { GlassSelect } from "@/shell/glass-select";
import type { AudioAsset, VoiceOption } from "@/projects/assets/types";
import { resolveVoicePreviewSrc } from "@/projects/assets/resolve-voice-preview-src";
import {
  claimVoicePreview,
  releaseVoicePreview,
} from "@/projects/assets/voice-preview-bus";

const PAGE_SIZE = 8;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  voices: VoiceOption[];
  selectedId?: string | null;
  onSelect: (voice: VoiceOption) => void;
  projectId: string;
  audios?: AudioAsset[];
};

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function VoiceCardPreview({
  voice,
  projectId,
  audios,
}: {
  voice: VoiceOption;
  projectId: string;
  audios?: AudioAsset[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      releaseVoicePreview(voice.id);
      audioRef.current = null;
    };
  }, [voice.id]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      setPlaying(false);
      return;
    }
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlaying(false);
    releaseVoicePreview(voice.id);
  }, [voice.id]);

  const toggle = () => {
    setError("");
    if (voice.status === "processing") {
      setError("音色处理中，暂不可试听");
      return;
    }
    if (voice.status === "failed") {
      setError("音色生成失败，无法试听");
      return;
    }

    let src = voice.previewUrl ?? null;
    if (!src) {
      const resolved = resolveVoicePreviewSrc({
        projectId,
        voiceId: voice.id,
        audios,
      });
      if (!resolved.ok) {
        setError(resolved.message);
        return;
      }
      src = resolved.src;
    }

    try {
      if (!audioRef.current) {
        const audio = new Audio();
        audio.preload = "none";
        audio.addEventListener("play", () => setPlaying(true));
        audio.addEventListener("pause", () => setPlaying(false));
        audio.addEventListener("ended", () => {
          setPlaying(false);
          releaseVoicePreview(voice.id);
        });
        audio.addEventListener("error", () => {
          setPlaying(false);
          setError("音频加载失败");
          releaseVoicePreview(voice.id);
        });
        audioRef.current = audio;
      }
      const audio = audioRef.current;
      claimVoicePreview(voice.id, stop);

      if (playing) {
        stop();
        return;
      }

      audio.src = src;
      void audio.play().catch(() => {
        setPlaying(false);
        setError("音频加载失败");
      });
    } catch {
      setError("当前环境不支持音频播放");
    }
  };

  return (
    <div className="voice-picker-card__preview">
      <button
        type="button"
        className={`amw-btn voice-picker-card__play${playing ? " is-playing" : ""}`}
        data-testid={`voice-picker-preview-${voice.id}`}
        aria-pressed={playing}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        {playing ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        {playing ? "播放中" : "试听"}
      </button>
      {error ? (
        <span className="voice-picker-card__preview-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function VoicePickerPanel({
  open,
  onOpenChange,
  anchorRef,
  voices,
  selectedId,
  onSelect,
  projectId,
  audios = [],
}: Props) {
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [language, setLanguage] = useState("");
  const [emotion, setEmotion] = useState("");
  const [tone, setTone] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);

  const debouncedSearch = useDebouncedValue(search, 250);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setGender("");
      setAgeRange("");
      setLanguage("");
      setEmotion("");
      setTone("");
      setSource("");
      setPage(0);
    }
  }, [open]);

  const filterOptions = useMemo(() => {
    const uniq = (values: (string | undefined)[]) =>
      [...new Set(values.filter(Boolean) as string[])].sort();
    return {
      gender: uniq(voices.map((v) => v.gender)),
      ageRange: uniq(voices.map((v) => v.ageRange)),
      language: uniq(voices.map((v) => v.language)),
      emotion: uniq(voices.map((v) => v.emotion)),
      tone: uniq(voices.map((v) => v.tone)),
      source: uniq(voices.map((v) => v.source)),
    };
  }, [voices]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return voices.filter((voice) => {
      if (q) {
        const hay = [
          voice.name,
          voice.label,
          voice.style,
          voice.description,
          voice.language,
          voice.emotion,
          voice.tone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (gender && voice.gender !== gender) return false;
      if (ageRange && voice.ageRange !== ageRange) return false;
      if (language && voice.language !== language) return false;
      if (emotion && voice.emotion !== emotion) return false;
      if (tone && voice.tone !== tone) return false;
      if (source && voice.source !== source) return false;
      return true;
    });
  }, [
    voices,
    debouncedSearch,
    gender,
    ageRange,
    language,
    emotion,
    tone,
    source,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, gender, ageRange, language, emotion, tone, source]);

  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  return (
    <VoiceAnchorPanel
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      testId="voice-picker-panel"
      title="选择音色"
    >
      <div className="voice-picker-panel">
        <div className="voice-picker-panel__filters">
          <input
            className="amw-input voice-picker-panel__search"
            type="search"
            placeholder="搜索音色名称"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid="voice-picker-search"
          />
          <div className="voice-picker-panel__filter-row">
            <GlassSelect
              label="性别"
              hideLabel
              value={gender}
              placeholder="性别"
              allowClear
              clearLabel="全部"
              options={filterOptions.gender.map((id) => ({
                id,
                label:
                  id === "male" ? "男" : id === "female" ? "女" : id === "neutral" ? "中性" : id,
              }))}
              onChange={setGender}
              menuPortal
            />
            <GlassSelect
              label="年龄段"
              hideLabel
              value={ageRange}
              placeholder="年龄"
              allowClear
              clearLabel="全部"
              options={filterOptions.ageRange.map((id) => ({ id, label: id }))}
              onChange={setAgeRange}
              menuPortal
            />
            <GlassSelect
              label="语言"
              hideLabel
              value={language}
              placeholder="语言"
              allowClear
              clearLabel="全部"
              options={filterOptions.language.map((id) => ({ id, label: id }))}
              onChange={setLanguage}
              menuPortal
            />
            <GlassSelect
              label="来源"
              hideLabel
              value={source}
              placeholder="来源"
              allowClear
              clearLabel="全部"
              options={filterOptions.source.map((id) => ({
                id,
                label:
                  id === "system"
                    ? "系统音色"
                    : id === "project"
                      ? "项目音色"
                      : id === "generated"
                        ? "生成音色"
                        : id,
              }))}
              onChange={setSource}
              menuPortal
            />
          </div>
          <div className="voice-picker-panel__tags">
            {filterOptions.emotion.map((tag) => (
              <button
                key={`emotion-${tag}`}
                type="button"
                className={`voice-picker-panel__tag${emotion === tag ? " is-active" : ""}`}
                onClick={() => setEmotion(emotion === tag ? "" : tag)}
              >
                {tag}
              </button>
            ))}
            {filterOptions.tone.map((tag) => (
              <button
                key={`tone-${tag}`}
                type="button"
                className={`voice-picker-panel__tag${tone === tag ? " is-active" : ""}`}
                onClick={() => setTone(tone === tag ? "" : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="voice-picker-panel__list" data-testid="voice-picker-list">
          {pageItems.length === 0 ? (
            <p className="voice-picker-panel__empty">没有匹配的音色</p>
          ) : (
            pageItems.map((voice) => (
              <article
                key={voice.id}
                className={`voice-picker-card${
                  selectedId === voice.id ? " is-selected" : ""
                }`}
                data-testid={`voice-picker-card-${voice.id}`}
              >
                <div className="voice-picker-card__main">
                  <strong>{voice.label || voice.name}</strong>
                  <div className="voice-picker-card__tags">
                    {voice.gender ? (
                      <span>
                        {voice.gender === "male"
                          ? "男"
                          : voice.gender === "female"
                            ? "女"
                            : "中性"}
                      </span>
                    ) : null}
                    {voice.ageRange ? <span>{voice.ageRange}</span> : null}
                    {voice.style ? <span>{voice.style}</span> : null}
                    {voice.language ? <span>{voice.language}</span> : null}
                  </div>
                  {voice.description ? (
                    <p className="voice-picker-card__desc">{voice.description}</p>
                  ) : null}
                </div>
                <div className="voice-picker-card__actions">
                  <VoiceCardPreview voice={voice} projectId={projectId} audios={audios} />
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary"
                    data-testid={`voice-picker-select-${voice.id}`}
                    onClick={() => {
                      onSelect(voice);
                      onOpenChange(false);
                    }}
                  >
                    选择
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {pageCount > 1 ? (
          <div className="voice-picker-panel__pager">
            <button
              type="button"
              className="amw-btn"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </button>
            <span>
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="amw-btn"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
    </VoiceAnchorPanel>
  );
}
