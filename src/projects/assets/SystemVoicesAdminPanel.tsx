"use client";

import { useCallback, useEffect, useState } from "react";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { validateVoiceAudioFileClient } from "@/projects/assets/voice-audio-validation";
import type { SystemVoiceRecord } from "@/projects/assets/system-voice-types";

type VoiceRow = Omit<SystemVoiceRecord, never>;

export function SystemVoicesAdminPanel() {
  const [voices, setVoices] = useState<VoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "neutral">("neutral");
  const [ageRange, setAgeRange] = useState("青年");
  const [language, setLanguage] = useState("中文");
  const [emotion, setEmotion] = useState("");
  const [style, setStyle] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/voices?status=all", {
        cache: "no-store",
      });
      const data = await parseResponseJson<{
        voices?: VoiceRow[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "加载音色失败");
      setVoices(data.voices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载音色失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const validationError = await validateVoiceAudioFileClient(file);
      if (validationError) throw new Error(validationError);
      const form = new FormData();
      form.set("file", file);
      form.set("name", name.trim() || file.name.replace(/\.[^.]+$/, ""));
      form.set("gender", gender);
      form.set("ageRange", ageRange);
      form.set("language", language);
      form.set("emotion", emotion);
      form.set("style", style);
      form.set("description", description);
      const res = await fetch("/api/admin/voices/upload", {
        method: "POST",
        body: form,
      });
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "上传失败");
      setName("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const patchVoice = async (
    voiceId: string,
    body: Record<string, unknown>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/voices/${encodeURIComponent(voiceId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "更新失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const softDelete = async (voiceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/voices/${encodeURIComponent(voiceId)}`,
        { method: "DELETE" },
      );
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "停用失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "停用失败");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (voiceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/voices/${encodeURIComponent(voiceId)}/restore`,
        { method: "POST" },
      );
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "恢复失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="ai-admin-voices"
      data-testid="admin-system-voices"
    >
      <div className="ai-admin-page-heading">
        <div>
          <h1>系统音色</h1>
          <p>上传后进入全局系统音色目录；普通用户仅可见 active 音色</p>
        </div>
      </div>

      <div className="ai-admin-voices__form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="音色名称"
          disabled={busy}
        />
        <select
          value={gender}
          onChange={(e) =>
            setGender(e.target.value as "male" | "female" | "neutral")
          }
          disabled={busy}
        >
          <option value="neutral">中性</option>
          <option value="female">女</option>
          <option value="male">男</option>
        </select>
        <input
          value={ageRange}
          onChange={(e) => setAgeRange(e.target.value)}
          placeholder="年龄段"
          disabled={busy}
        />
        <input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="语言"
          disabled={busy}
        />
        <input
          value={emotion}
          onChange={(e) => setEmotion(e.target.value)}
          placeholder="情绪"
          disabled={busy}
        />
        <input
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="风格"
          disabled={busy}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述"
          disabled={busy}
        />
        <label className="ai-admin-voices__upload">
          上传 MP3/WAV/OGG（4–6 秒，≤10MB）
          <input
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onUpload(file);
            }}
          />
        </label>
      </div>

      {error ? (
        <p className="ai-admin-voices__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p>加载中…</p>
      ) : (
        <ul className="ai-admin-voices__list">
          {voices.map((voice) => (
            <li key={voice.id} data-testid={`admin-voice-${voice.id}`}>
              <div>
                <strong>{voice.name}</strong>
                <small>
                  {voice.gender} · {voice.ageRange || "—"} ·{" "}
                  {voice.language || "—"} · {voice.status}
                </small>
                <p>{voice.description || voice.style}</p>
              </div>
              <div className="ai-admin-voices__actions">
                {voice.mediaId ? (
                  <audio controls preload="none" src={voice.previewUrl}>
                    <track kind="captions" />
                  </audio>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const next = window.prompt("音色名称", voice.name);
                    if (next == null) return;
                    void patchVoice(voice.id, { name: next });
                  }}
                >
                  编辑名称
                </button>
                {voice.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void softDelete(voice.id)}
                  >
                    停用
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(voice.id)}
                  >
                    恢复
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
