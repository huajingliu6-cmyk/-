"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { VoiceAnchorPanel } from "@/projects/assets/VoiceAnchorPanel";
import { GlassSelect } from "@/shell/glass-select";
import type { VoiceOption } from "@/projects/assets/types";
import {
  VOICE_GENERATION_PROMPT_MAX_LENGTH,
} from "@/projects/assets/voice-audio-constants";
import {
  generatedVoiceToOption,
  resolveVoiceGenerationAdapter,
  type VoiceGenerationResult,
} from "@/projects/assets/voice-generation-adapter";
import {
  claimVoicePreview,
  releaseVoicePreview,
} from "@/projects/assets/voice-preview-bus";

type GenerateState = "idle" | "generating" | "ready" | "failed";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  projectId: string;
  characterId?: string;
  onGeneratedSelect: (voice: VoiceOption) => void;
  onStatus?: (message: string) => void;
};

const GENDER_OPTIONS = [
  { id: "female", label: "女" },
  { id: "male", label: "男" },
  { id: "neutral", label: "中性" },
];

const AGE_OPTIONS = [
  { id: "少年", label: "少年" },
  { id: "青年", label: "青年" },
  { id: "中年", label: "中年" },
  { id: "老年", label: "老年" },
];

const EMOTION_OPTIONS = [
  { id: "温柔", label: "温柔" },
  { id: "平静", label: "平静" },
  { id: "活泼", label: "活泼" },
  { id: "激烈", label: "激烈" },
  { id: "温暖", label: "温暖" },
];

const STYLE_OPTIONS = [
  { id: "叙事", label: "叙事" },
  { id: "日常", label: "日常" },
  { id: "戏剧", label: "戏剧" },
  { id: "旁白", label: "旁白" },
  { id: "中音", label: "中音" },
  { id: "低音", label: "低音" },
];

function ResultPreview({
  result,
}: {
  result: VoiceGenerationResult;
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
      releaseVoicePreview(result.voiceId);
      audioRef.current = null;
    };
  }, [result.voiceId]);

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) {
      setPlaying(false);
      return;
    }
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlaying(false);
    releaseVoicePreview(result.voiceId);
  };

  const toggle = () => {
    setError("");
    if (!result.previewUrl) {
      setError("生成预览尚未接入（Mock），暂不可试听");
      return;
    }
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "none";
      audio.addEventListener("play", () => setPlaying(true));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("ended", () => {
        setPlaying(false);
        releaseVoicePreview(result.voiceId);
      });
      audio.addEventListener("error", () => {
        setPlaying(false);
        setError("音频加载失败");
      });
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    claimVoicePreview(result.voiceId, stop);
    if (playing) {
      stop();
      return;
    }
    audio.src = result.previewUrl;
    void audio.play().catch(() => setError("音频加载失败"));
  };

  return (
    <div className="voice-generate-panel__result">
      <strong>{result.name}</strong>
      <p className="voice-generate-panel__prompt">{result.prompt}</p>
      {result.style ? (
        <span className="voice-generate-panel__tag">{result.style}</span>
      ) : null}
      <div className="voice-generate-panel__result-actions">
        <button
          type="button"
          className={`amw-btn${playing ? " is-playing" : ""}`}
          data-testid="voice-generate-preview"
          onClick={toggle}
        >
          {playing ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          试听
        </button>
        {error ? (
          <span className="voice-generate-panel__preview-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function VoiceGeneratePanel({
  open,
  onOpenChange,
  anchorRef,
  projectId,
  characterId,
  onGeneratedSelect,
  onStatus,
}: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [emotion, setEmotion] = useState("");
  const [style, setStyle] = useState("");
  const [state, setState] = useState<GenerateState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<VoiceGenerationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setName("");
      setPrompt("");
      setGender("");
      setAgeRange("");
      setEmotion("");
      setStyle("");
      setState("idle");
      setError("");
      setResult(null);
    }
  }, [open]);

  const promptTrimmed = prompt.trim();
  const remaining = VOICE_GENERATION_PROMPT_MAX_LENGTH - prompt.length;
  const canGenerate =
    promptTrimmed.length > 0 &&
    state !== "generating" &&
    name.trim().length > 0;

  const runGenerate = () => {
    if (!canGenerate) return;
    setError("");
    setState("generating");
    setResult(null);
    onStatus?.("正在生成音色…");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const adapter = resolveVoiceGenerationAdapter();
        const generated = await adapter.generate({
          projectId,
          characterId,
          name: name.trim(),
          prompt: promptTrimmed,
          gender: gender || undefined,
          ageRange: ageRange || undefined,
          emotion: emotion || undefined,
          style: style || undefined,
        });
        if (controller.signal.aborted) return;
        setResult(generated);
        setState("ready");
        onStatus?.("音色生成完成（Mock，无真实音频）。");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState("failed");
        const message =
          caught instanceof Error ? caught.message : "音色生成失败";
        setError(message);
        onStatus?.(message);
      }
    })();
  };

  return (
    <VoiceAnchorPanel
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      testId="voice-generate-panel"
      title="生成音色"
    >
      <div className="voice-generate-panel">
        <div className="amw-field">
          <label htmlFor="voice-generate-name">音色名称</label>
          <input
            id="voice-generate-name"
            className="amw-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：温柔叙事女声"
            data-testid="voice-generate-name"
          />
        </div>

        <div className="amw-field">
          <label htmlFor="voice-generate-prompt">音色提示词</label>
          <textarea
            id="voice-generate-prompt"
            className="amw-input voice-generate-panel__textarea"
            value={prompt}
            maxLength={VOICE_GENERATION_PROMPT_MAX_LENGTH}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="成熟、温柔、清晰，语速适中，适合叙事和情感对白"
            data-testid="voice-generate-prompt"
            rows={4}
          />
          <p className="amw-hint voice-generate-panel__counter">
            剩余 {remaining} 字
          </p>
        </div>

        <div className="voice-generate-panel__filters">
          <GlassSelect
            label="性别"
            value={gender}
            placeholder="性别"
            allowClear
            clearLabel="不限"
            options={GENDER_OPTIONS}
            onChange={setGender}
            menuPortal
          />
          <GlassSelect
            label="年龄段"
            value={ageRange}
            placeholder="年龄段"
            allowClear
            clearLabel="不限"
            options={AGE_OPTIONS}
            onChange={setAgeRange}
            menuPortal
          />
          <GlassSelect
            label="情绪"
            value={emotion}
            placeholder="情绪"
            allowClear
            clearLabel="不限"
            options={EMOTION_OPTIONS}
            onChange={setEmotion}
            menuPortal
          />
          <GlassSelect
            label="风格"
            value={style}
            placeholder="风格"
            allowClear
            clearLabel="不限"
            options={STYLE_OPTIONS}
            onChange={setStyle}
            menuPortal
          />
        </div>

        {state === "generating" ? (
          <p className="voice-generate-panel__status" data-testid="voice-generate-status">
            正在生成音色…
          </p>
        ) : null}
        {state === "failed" && error ? (
          <p className="amw-field-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="amw-btn amw-btn-primary voice-generate-panel__submit"
          data-testid="voice-generate-submit"
          disabled={!canGenerate}
          onClick={runGenerate}
        >
          生成音色
        </button>

        {result && state === "ready" ? (
          <>
            <ResultPreview result={result} />
            <div className="voice-generate-panel__footer">
              <button
                type="button"
                className="amw-btn"
                onClick={() => {
                  setResult(null);
                  setState("idle");
                  setError("");
                }}
              >
                重新生成
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="voice-generate-bind"
                onClick={() => {
                  onGeneratedSelect(generatedVoiceToOption(result));
                  onOpenChange(false);
                }}
              >
                选择并绑定
              </button>
            </div>
          </>
        ) : null}
      </div>
    </VoiceAnchorPanel>
  );
}
