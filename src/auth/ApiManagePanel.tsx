"use client";

import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import type {
  GenerationApiConfigPublic,
  GenerationApiId,
  GenerationApiProvider,
} from "@/auth/api-config";

type Draft = {
  provider: GenerationApiProvider;
  apiUrl: string;
  apiKey: string;
  clearApiKey: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ApiManagePanel({ open, onClose }: Props) {
  const [configs, setConfigs] = useState<GenerationApiConfigPublic[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setNotice("");
    void (async () => {
      try {
        const res = await fetch("/api/admin/api-configs");
        const payload = (await res.json()) as {
          configs?: GenerationApiConfigPublic[];
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "加载失败");
        if (cancelled) return;
        const list = payload.configs ?? [];
        setConfigs(list);
        const nextDrafts: Record<string, Draft> = {};
        for (const item of list) {
          nextDrafts[item.id] = {
            provider: item.provider,
            apiUrl: item.apiUrl,
            apiKey: "",
            clearApiKey: false,
          };
        }
        setDrafts(nextDrafts);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, ...patch },
    }));
  };

  const onSave = async (id: GenerationApiId) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/api-configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          provider: draft.provider,
          apiUrl: draft.apiUrl,
          apiKey: draft.apiKey.trim() || undefined,
          clearApiKey: draft.clearApiKey,
        }),
      });
      const payload = (await res.json()) as {
        config?: GenerationApiConfigPublic;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "保存失败");
      if (payload.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === id ? payload.config! : c)),
        );
        updateDraft(id, { apiKey: "", clearApiKey: false });
      }
      setNotice(`已保存：${payload.config?.label ?? id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <KeyRound className="h-4 w-4 text-amber-300" />
            管理 API
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            为每个生成按钮单独配置接口。模式选「HTTP」并填写地址后，对应生成会请求该 API；密钥不会明文回传。
          </p>

          {loading && (
            <div className="text-xs text-zinc-500">加载配置中…</div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          {configs.map((config) => {
            const draft = drafts[config.id];
            if (!draft) return null;
            return (
              <div
                key={config.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <div className="mb-2">
                  <div className="text-sm font-medium text-zinc-100">
                    {config.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {config.description}
                  </div>
                </div>

                <div className="mb-2 grid gap-2 sm:grid-cols-2">
                  <label className="block text-[11px] text-zinc-400">
                    模式
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none"
                      value={draft.provider}
                      onChange={(e) =>
                        updateDraft(config.id, {
                          provider: e.target.value as GenerationApiProvider,
                        })
                      }
                    >
                      <option value="mock">本地演示（mock）</option>
                      <option value="http">HTTP 接口</option>
                    </select>
                  </label>
                  <label className="block text-[11px] text-zinc-400">
                    API 地址
                    <input
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none"
                      placeholder="https://api.example.com/v1/generate"
                      value={draft.apiUrl}
                      onChange={(e) =>
                        updateDraft(config.id, { apiUrl: e.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="mb-2 block text-[11px] text-zinc-400">
                  API Key
                  <input
                    type="password"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none"
                    placeholder={
                      config.hasApiKey
                        ? `已配置 ${config.apiKeyMasked}，留空则保持不变`
                        : "可选，Bearer Token"
                    }
                    value={draft.apiKey}
                    disabled={draft.clearApiKey}
                    onChange={(e) =>
                      updateDraft(config.id, { apiKey: e.target.value })
                    }
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <input
                      type="checkbox"
                      checked={draft.clearApiKey}
                      onChange={(e) =>
                        updateDraft(config.id, {
                          clearApiKey: e.target.checked,
                          apiKey: e.target.checked ? "" : draft.apiKey,
                        })
                      }
                    />
                    清除已保存密钥
                  </label>
                  <button
                    type="button"
                    disabled={savingId === config.id}
                    className="ml-auto rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
                    onClick={() => void onSave(config.id)}
                  >
                    {savingId === config.id ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
