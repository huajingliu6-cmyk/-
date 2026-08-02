"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { GlassSelect } from "@/shell/glass-select";
import {
  btnPrimaryClassName,
  btnSecondaryClassName,
  InlineNotices,
  inputClassName,
  readJson,
  SectionTitle,
} from "@/auth/ai-admin/shared";
import type {
  AiModality,
  ConnectionDraft,
  ModelConnectionPublic,
  ModelProviderMode,
} from "@/auth/ai-admin/types";
import { testStatusLabel } from "@/auth/ai-admin/types";

type Props = {
  active: boolean;
};

const MODALITY_OPTIONS: Array<{ id: AiModality; label: string }> = [
  { id: "text", label: "文本" },
  { id: "image", label: "图像" },
  { id: "audio", label: "音频" },
  { id: "video", label: "视频" },
];

const PROVIDER_OPTIONS: Array<{ id: ModelProviderMode; label: string }> = [
  { id: "mock", label: "本地演示（mock）" },
  { id: "http", label: "HTTP 接口" },
  { id: "aliyun-wan27", label: "阿里云万相（付费）" },
];

function emptyDraft(modality: AiModality = "text"): ConnectionDraft {
  return {
    displayName: "",
    modality,
    providerMode: "mock",
    baseUrl: "",
    modelId: "",
    apiKey: "",
    clearApiKey: false,
    enabled: true,
  };
}

function draftFromConnection(conn: ModelConnectionPublic): ConnectionDraft {
  return {
    displayName: conn.displayName,
    modality: conn.modality,
    providerMode: conn.providerMode,
    baseUrl: conn.baseUrl ?? "",
    modelId: conn.modelId ?? "",
    apiKey: "",
    clearApiKey: false,
    enabled: conn.enabled,
  };
}

function testStatusClass(status: ModelConnectionPublic["lastTestStatus"]): string {
  switch (status) {
    case "success":
      return "text-emerald-400";
    case "failed":
      return "text-rose-400";
    case "testing":
      return "text-amber-300";
    default:
      return "text-zinc-500";
  }
}

export function ModelConnectionsTab({ active }: Props) {
  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [createDraft, setCreateDraft] = useState<ConnectionDraft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchEpoch, setFetchEpoch] = useState(0);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/model-connections");
      const payload = await readJson<{
        connections?: ModelConnectionPublic[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(payload.error ?? "加载模型连接失败");
      const list = payload.connections ?? [];
      setConnections(list);
      const nextDrafts: Record<string, ConnectionDraft> = {};
      for (const conn of list) {
        nextDrafts[conn.id] = draftFromConnection(conn);
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载模型连接失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Fetch connections when tab becomes active (external sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-activate
    void loadConnections();
  }, [active, fetchEpoch, loadConnections]);

  const updateDraft = (id: string, patch: Partial<ConnectionDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, ...patch },
    }));
  };

  const onCreate = async () => {
    if (!createDraft) return;
    if (!createDraft.displayName.trim()) {
      setError("请填写配置名称");
      return;
    }
    setBusyId("__create__");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/model-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: createDraft.displayName.trim(),
          modality: createDraft.modality,
          providerMode: createDraft.providerMode,
          baseUrl: createDraft.baseUrl.trim() || null,
          modelId: createDraft.modelId.trim() || null,
          enabled: createDraft.enabled,
          apiKey: createDraft.apiKey.trim() || undefined,
        }),
      });
      const payload = await readJson<{
        connection?: ModelConnectionPublic;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(payload.error ?? "创建失败");
      setCreateDraft(null);
      setNotice(`已创建：${payload.connection?.displayName ?? "新连接"}`);
      setFetchEpoch((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusyId(null);
    }
  };

  const onSave = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/model-connections/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          providerMode: draft.providerMode,
          baseUrl: draft.baseUrl.trim() || null,
          modelId: draft.modelId.trim() || null,
          enabled: draft.enabled,
          apiKey: draft.apiKey.trim() || undefined,
          clearApiKey: draft.clearApiKey,
        }),
      });
      const payload = await readJson<{
        connection?: ModelConnectionPublic;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(payload.error ?? "保存失败");
      if (payload.connection) {
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? payload.connection! : c)),
        );
        updateDraft(id, { apiKey: "", clearApiKey: false });
      }
      setNotice(`已保存：${draft.displayName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusyId(null);
    }
  };

  const runTest = async (id: string, confirmPaid = false) => {
    setBusyId(`test-${id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch(
        `/api/admin/model-connections/${encodeURIComponent(id)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmPaid,
            confirmPaidTest: confirmPaid,
          }),
        },
      );
      const payload = await readJson<{
        success?: boolean;
        note?: string;
        errorCode?: string | null;
        error?: string;
      }>(res);
      if (
        payload.errorCode === "AI_PAID_CONFIRMATION_REQUIRED" ||
        payload.errorCode === "PAID_TEST_CONFIRM_REQUIRED"
      ) {
        const confirmed = window.confirm(
          "HTTP 测试可能产生 Provider 费用。确认继续？",
        );
        if (!confirmed) {
          setNotice("已取消测试连接");
          return;
        }
        await runTest(id, true);
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? payload.note ?? "测试失败");
      setNotice(
        payload.success
          ? `测试成功${payload.note ? `（${payload.note}）` : ""}`
          : `测试失败：${payload.note ?? payload.errorCode ?? id}`,
      );
      setFetchEpoch((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setBusyId(null);
    }
  };

  const renderForm = (
    draft: ConnectionDraft,
    onChange: (patch: Partial<ConnectionDraft>) => void,
    conn: ModelConnectionPublic | null,
    options: { readOnly?: boolean; showClearKey?: boolean },
  ) => (
    <>
      <label className="mb-2 block text-[11px] text-zinc-400">
        配置名称
        <input
          className={inputClassName}
          value={draft.displayName}
          disabled={options.readOnly}
          onChange={(e) => onChange({ displayName: e.target.value })}
        />
      </label>

      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        <GlassSelect
          label="模型类型"
          value={draft.modality}
          disabled={options.readOnly || !!conn}
          options={MODALITY_OPTIONS}
          onChange={(id) => onChange({ modality: id as AiModality })}
        />
        <GlassSelect
          label="Provider 模式"
          value={draft.providerMode}
          disabled={options.readOnly}
          options={
            draft.modality === "video"
              ? PROVIDER_OPTIONS
              : PROVIDER_OPTIONS.filter((o) => o.id !== "aliyun-wan27")
          }
          onChange={(id) =>
            onChange({ providerMode: id as ModelProviderMode })
          }
        />
      </div>

      <label className="mb-2 block text-[11px] text-zinc-400">
        API 地址（baseUrl）
        <input
          className={inputClassName}
          placeholder="https://api.example.com/compatible-mode/v1"
          value={draft.baseUrl}
          disabled={options.readOnly}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
        />
      </label>

      <label className="mb-2 block text-[11px] text-zinc-400">
        模型 / 接入点 ID
        <input
          className={inputClassName}
          placeholder="模型名或接入点"
          value={draft.modelId}
          disabled={options.readOnly}
          onChange={(e) => onChange({ modelId: e.target.value })}
        />
      </label>

      {!options.readOnly ? (
        <label className="mb-2 block text-[11px] text-zinc-400">
          API Key
          <input
            type="password"
            className={inputClassName}
            placeholder={
              conn?.apiKeyConfigured
                ? `已配置 ${conn.apiKeyMasked}，留空则保持不变`
                : "粘贴 API Key（将加密落盘）"
            }
            value={draft.apiKey}
            disabled={draft.clearApiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={options.readOnly}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          启用
        </label>
        {options.showClearKey && !options.readOnly ? (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={draft.clearApiKey}
              onChange={(e) =>
                onChange({
                  clearApiKey: e.target.checked,
                  apiKey: e.target.checked ? "" : draft.apiKey,
                })
              }
            />
            清除已保存密钥
          </label>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-zinc-500">
        管理模型接入连接。密钥不会明文回传；留空保留原 Key。付费 Provider 受
        ALLOW_PAID_GENERATION 门禁约束。
      </p>

      <InlineNotices error={error} notice={notice} />

      {loading ? (
        <div className="text-xs text-zinc-500">加载模型连接中…</div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <SectionTitle>模型连接</SectionTitle>
        <button
          type="button"
          className={`${btnSecondaryClassName} inline-flex items-center gap-1`}
          onClick={() => setCreateDraft(emptyDraft())}
          disabled={!!createDraft}
        >
          <Plus className="h-3.5 w-3.5" />
          新建连接
        </button>
      </div>

      {createDraft ? (
        <div className="rounded-xl border border-amber-500/30 bg-zinc-900/60 p-3">
          <div className="mb-2 text-sm font-medium text-amber-200">新建模型连接</div>
          {renderForm(createDraft, (patch) =>
            setCreateDraft((prev) => ({ ...prev!, ...patch })),
          null, { showClearKey: false })}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimaryClassName}
              disabled={busyId === "__create__"}
              onClick={() => void onCreate()}
            >
              {busyId === "__create__" ? "创建中…" : "创建"}
            </button>
            <button
              type="button"
              className={btnSecondaryClassName}
              onClick={() => setCreateDraft(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {connections.map((conn) => {
          const draft = drafts[conn.id];
          const expanded = expandedId === conn.id;
          const isLegacy =
            !!conn.legacyVirtual || conn.id.startsWith("legacy-slot-");
          if (!draft) return null;
          return (
            <div
              key={conn.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40"
              data-testid={`model-connection-${conn.id}`}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                onClick={() => setExpandedId(expanded ? null : conn.id)}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100">
                    {conn.displayName}
                    {isLegacy ? (
                      <span className="ml-2 text-[10px] text-zinc-500">
                        （旧版虚拟）
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {conn.modality} · {conn.providerMode} ·{" "}
                    <span className={testStatusClass(conn.lastTestStatus)}>
                      {testStatusLabel(conn.lastTestStatus)}
                    </span>
                    {conn.lastTestMessage ? ` · ${conn.lastTestMessage}` : ""}
                  </div>
                </div>
                <span
                  className={`text-[10px] ${conn.enabled ? "text-emerald-400" : "text-zinc-500"}`}
                >
                  {conn.enabled ? "已启用" : "已禁用"}
                </span>
              </button>

              {expanded ? (
                <div className="border-t border-zinc-800 px-3 pb-3 pt-2">
                  {isLegacy ? (
                    <p className="mb-2 text-[11px] text-zinc-500">
                      保存将写入对应 profile 槽位（generation-api-configs），运行时可直接生效。
                    </p>
                  ) : null}
                  {renderForm(
                    draft,
                    (patch) => updateDraft(conn.id, patch),
                    conn,
                    { readOnly: false, showClearKey: true },
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={btnSecondaryClassName}
                      disabled={busyId === `test-${conn.id}`}
                      onClick={() => void runTest(conn.id)}
                    >
                      {busyId === `test-${conn.id}` ? "测试中…" : "测试连接"}
                    </button>
                    <button
                      type="button"
                      className={`${btnPrimaryClassName} ml-auto`}
                      disabled={busyId === conn.id}
                      onClick={() => void onSave(conn.id)}
                    >
                      {busyId === conn.id ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
