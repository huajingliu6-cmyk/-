"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Eye,
  EyeOff,
  FlaskConical,
  Image as ImageIcon,
  Plus,
  Save,
  Search,
  ServerCog,
  Type,
  Video,
} from "lucide-react";
import type {
  AiModality,
  ConnectionDraft,
  ModelConnectionPublic,
  ModelProviderMode,
} from "@/auth/ai-admin/types";
import { readJson } from "@/auth/ai-admin/shared";
import {
  connectionHost,
  modalityLabel,
  providerLabel,
} from "@/auth/ai-admin/admin-data";
import { CapabilityRulesTab } from "@/auth/ai-admin/CapabilityRulesTab";
import type { AdminView } from "@/auth/ai-admin/admin-view";

type Filter = "all" | AiModality;

type ModelConnectionsViewProps = {
  onNavigate?: (view: AdminView) => void;
};

function toDraft(connection: ModelConnectionPublic): ConnectionDraft {
  return {
    displayName: connection.displayName,
    modality: connection.modality,
    providerMode: connection.providerMode,
    baseUrl: connection.baseUrl ?? "",
    modelId: connection.modelId ?? "",
    apiKey: "",
    clearApiKey: false,
    enabled: connection.enabled,
  };
}

function newDraft(): ConnectionDraft {
  return {
    displayName: "新模型连接",
    modality: "text",
    providerMode: "http",
    baseUrl: "",
    modelId: "",
    apiKey: "",
    clearApiKey: false,
    enabled: true,
  };
}

function modalityIcon(modality: AiModality) {
  if (modality === "image") return ImageIcon;
  if (modality === "video") return Video;
  if (modality === "audio") return AudioLines;
  return Type;
}

function statusMeta(connection: ModelConnectionPublic | null) {
  if (!connection) return { label: "尚未保存", tone: "neutral", Icon: CircleDashed };
  if (!connection.enabled) return { label: "已停用", tone: "neutral", Icon: CircleDashed };
  if (connection.lastTestStatus === "success") {
    return { label: "连接正常", tone: "success", Icon: CircleCheck };
  }
  if (connection.lastTestStatus === "failed") {
    return { label: "测试失败", tone: "danger", Icon: CircleX };
  }
  return { label: "尚未测试", tone: "warning", Icon: CircleDashed };
}

export function ModelConnectionsView({ onNavigate }: ModelConnectionsViewProps = {}) {
  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<ConnectionDraft>(newDraft);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "save-test" | "" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = connections.find((item) => item.id === selectedId) ?? null;

  const load = useCallback(async (preferId?: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/model-connections", {
        cache: "no-store",
      });
      const payload = await readJson<{
        connections?: ModelConnectionPublic[];
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(payload.error ?? "加载连接失败");
      const nextConnections = payload.connections ?? [];
      setConnections(nextConnections);
      const nextId =
        preferId && nextConnections.some((item) => item.id === preferId)
          ? preferId
          : nextConnections[0]?.id ?? "";
      setSelectedId(nextId);
      const next = nextConnections.find((item) => item.id === nextId);
      if (next) setDraft(toDraft(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载连接失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return connections.filter((connection) => {
      if (filter !== "all" && connection.modality !== filter) return false;
      if (!normalized) return true;
      return [
        connection.displayName,
        connection.modelId,
        connection.baseUrl,
        connection.providerMode,
      ].some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [connections, filter, query]);

  const selectConnection = (connection: ModelConnectionPublic) => {
    setCreating(false);
    setSelectedId(connection.id);
    setDraft(toDraft(connection));
    setShowKey(false);
    setError("");
    setNotice("");
  };

  const startCreate = () => {
    setCreating(true);
    setSelectedId("");
    setDraft(newDraft());
    setShowKey(false);
    setError("");
    setNotice("");
  };

  const save = async (): Promise<ModelConnectionPublic> => {
    if (!draft.displayName.trim()) throw new Error("请填写连接名称");
    const isCreate = creating || !selected;
    const response = await fetch(
      isCreate
        ? "/api/admin/model-connections"
        : `/api/admin/model-connections/${encodeURIComponent(selected.id)}`,
      {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          modality: draft.modality,
          providerMode: draft.providerMode,
          baseUrl: draft.baseUrl.trim() || null,
          modelId: draft.modelId.trim() || null,
          apiKey: draft.apiKey.trim() || undefined,
          clearApiKey: draft.clearApiKey,
          enabled: draft.enabled,
        }),
      },
    );
    const payload = await readJson<{
      connection?: ModelConnectionPublic;
      error?: string;
    }>(response);
    if (!response.ok || !payload.connection) {
      throw new Error(payload.error ?? "保存连接失败");
    }
    await load(payload.connection.id);
    setCreating(false);
    return payload.connection;
  };

  const test = async (connectionId: string, confirmPaid = false) => {
    const response = await fetch(
      `/api/admin/model-connections/${encodeURIComponent(connectionId)}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmPaid, confirmPaidTest: confirmPaid }),
      },
    );
    const payload = await readJson<{
      success?: boolean;
      note?: string;
      status?: string;
      errorCode?: string | null;
      error?: string;
    }>(response);
    if (
      payload.errorCode === "AI_PAID_CONFIRMATION_REQUIRED" ||
      payload.errorCode === "PAID_TEST_CONFIRM_REQUIRED"
    ) {
      const confirmed = window.confirm("HTTP 测试可能产生 Provider 费用。确认继续？");
      if (!confirmed) throw new Error("已取消测试连接");
      return test(connectionId, true);
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error ?? payload.note ?? payload.status ?? "测试失败");
    }
    await load(connectionId);
    return payload.note ?? payload.status ?? "连接测试通过";
  };

  const runAction = async (mode: "save" | "test" | "save-test") => {
    setBusy(mode);
    setError("");
    setNotice("");
    try {
      if (mode === "test") {
        if (!selected || creating) throw new Error("请先保存新连接再测试");
        const message = await test(selected.id);
        setNotice(message);
      } else {
        const connection = await save();
        if (mode === "save-test") {
          const message = await test(connection.id);
          setNotice(`已保存并测试：${message}`);
        } else {
          setNotice(`已保存：${connection.displayName}`);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const status = statusMeta(selected);
  const StatusIcon = status.Icon;

  return (
    <section className="ai-admin-view" data-testid="admin-model-connections">
      <div className="ai-admin-page-heading">
        <div><h1>API 连接</h1><p>模型服务只配置一次，可被多个业务能力复用</p></div>
        <button type="button" className="ai-admin-button ai-admin-button--primary" onClick={startCreate}>
          <Plus aria-hidden />新建连接
        </button>
      </div>

      {error ? <div className="ai-admin-notice ai-admin-notice--error" role="alert">{error}</div> : null}
      {notice ? <div className="ai-admin-notice ai-admin-notice--success" role="status">{notice}</div> : null}

      <div className="ai-admin-connections-workspace">
        <aside className="ai-admin-connection-library" aria-label="连接列表">
          <div className="ai-admin-connection-library__head">
            <div><h2>连接库</h2><p>{connections.length} 条连接</p></div>
            <ServerCog aria-hidden />
          </div>
          <label className="ai-admin-search">
            <Search aria-hidden />
            <span className="sr-only">搜索连接</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、模型或地址" />
          </label>
          <div className="ai-admin-filter-row" aria-label="连接类型筛选">
            {([
              ["all", "全部"],
              ["text", "文本"],
              ["image", "图像"],
              ["audio", "音频"],
              ["video", "视频"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>

          <div className="ai-admin-connection-list">
            {loading ? <p className="ai-admin-empty">加载连接中…</p> : null}
            {!loading && filtered.length === 0 ? <p className="ai-admin-empty">没有符合条件的连接</p> : null}
            {filtered.map((connection) => {
              const Icon = modalityIcon(connection.modality);
              const meta = statusMeta(connection);
              return (
                <button
                  key={connection.id}
                  type="button"
                  className="ai-admin-connection-row"
                  aria-current={!creating && selectedId === connection.id ? "true" : undefined}
                  onClick={() => selectConnection(connection)}
                >
                  <span className={`ai-admin-modality-icon is-${connection.modality}`}><Icon aria-hidden /></span>
                  <span className="ai-admin-connection-row__copy">
                    <strong>{connection.displayName}</strong>
                    <small>{connection.modelId || "未填模型"} · {connectionHost(connection.baseUrl)}</small>
                  </span>
                  <i className={`ai-admin-health-dot is-${meta.tone}`} aria-label={meta.label} />
                </button>
              );
            })}
          </div>
        </aside>

        <article className="ai-admin-connection-editor">
          <header className="ai-admin-editor-head">
            <div>
              <p>CONNECTION SETTINGS</p>
              <h2>{draft.displayName || "未命名连接"}</h2>
              <small>{modalityLabel(draft.modality)} · {providerLabel(draft.providerMode)}</small>
            </div>
            <span className={`ai-admin-status-badge is-${status.tone}`}><StatusIcon aria-hidden />{status.label}</span>
          </header>

          <div className="ai-admin-editor-body">
            <section className="ai-admin-form-section">
              <div className="ai-admin-form-section__title"><span>01</span><div><strong>连接身份</strong><small>管理员可识别的名称和模型类型</small></div></div>
              <div className="ai-admin-fields">
                <label className="ai-admin-field ai-admin-field--wide"><span>连接名称</span><input value={draft.displayName} onChange={(event) => setDraft((value) => ({ ...value, displayName: event.target.value }))} /></label>
                <fieldset className="ai-admin-field ai-admin-field--wide">
                  <legend>模型类型</legend>
                  <div className="ai-admin-segmented">
                    {(["text", "image", "audio", "video"] as const).map((modality) => {
                      const Icon = modalityIcon(modality);
                      return <button key={modality} type="button" aria-pressed={draft.modality === modality} disabled={!creating && Boolean(selected)} onClick={() => setDraft((value) => ({ ...value, modality, providerMode: modality === "video" || value.providerMode !== "aliyun-wan27" ? value.providerMode : "http" }))}><Icon aria-hidden />{modalityLabel(modality)}</button>;
                    })}
                  </div>
                </fieldset>
              </div>
            </section>

            <section className="ai-admin-form-section">
              <div className="ai-admin-form-section__title"><span>02</span><div><strong>服务参数</strong><small>地址、模型 ID 与访问密钥</small></div></div>
              <div className="ai-admin-fields">
                <label className="ai-admin-field"><span>接入方式</span>
                  <select value={draft.providerMode} onChange={(event) => setDraft((value) => ({ ...value, providerMode: event.target.value as ModelProviderMode }))}>
                    <option value="http">HTTP / OpenAI 兼容</option>
                    <option value="aliyun-wan27" disabled={draft.modality !== "video"}>阿里云万相</option>
                    <option value="mock">本地 Mock</option>
                  </select>
                </label>
                <label className="ai-admin-field"><span>模型 / 接入点 ID</span><input value={draft.modelId} onChange={(event) => setDraft((value) => ({ ...value, modelId: event.target.value }))} placeholder="模型名或 ep-xxxx" /></label>
                <label className="ai-admin-field ai-admin-field--wide"><span>API 基础地址</span><input value={draft.baseUrl} onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
                <label className="ai-admin-field ai-admin-field--wide"><span>API Key</span>
                  <span className="ai-admin-key-input"><input type={showKey ? "text" : "password"} value={draft.apiKey} disabled={draft.clearApiKey} onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))} placeholder={selected?.apiKeyConfigured ? `已配置 ${selected.apiKeyMasked}，留空保持不变` : "粘贴 API Key（保存后加密）"} /><button type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</button></span>
                  <small>保存后只显示密钥末四位</small>
                </label>
                {selected?.apiKeyConfigured ? <label className="ai-admin-checkbox"><input type="checkbox" checked={draft.clearApiKey} onChange={(event) => setDraft((value) => ({ ...value, clearApiKey: event.target.checked, apiKey: event.target.checked ? "" : value.apiKey }))} />清除已保存密钥</label> : null}
              </div>
            </section>

            <section className="ai-admin-form-section ai-admin-form-section--rules">
              <div className="ai-admin-form-section__title">
                <span>03</span>
                <div>
                  <strong>关联任务规则</strong>
                  <small>当前连接实际承载的业务能力及其规则</small>
                </div>
              </div>
              <div className="ai-admin-connection-rules">
                {creating || !selected ? (
                  <p
                    className="ai-admin-connection-rules__hint"
                    data-testid="admin-connection-rules-unsaved"
                  >
                    保存连接后，可在能力线路中绑定业务能力并配置对应任务规则。
                  </p>
                ) : (
                  <CapabilityRulesTab
                    active
                    embedded
                    connectionId={selected.id}
                    onNavigate={onNavigate}
                  />
                )}
              </div>
            </section>

            <div className="ai-admin-enable-row">
              <div><Activity aria-hidden /><span><strong>启用此连接</strong><small>停用后，绑定到它的业务能力将停止调用</small></span></div>
              <label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.checked }))} /><span aria-hidden />{draft.enabled ? "启用" : "停用"}</label>
            </div>
          </div>

          <footer className="ai-admin-editor-footer">
            <button type="button" className="ai-admin-button" disabled={Boolean(busy) || creating || !selected} onClick={() => void runAction("test")}><FlaskConical aria-hidden />{busy === "test" ? "测试中…" : "测试当前连接"}</button>
            <button type="button" className="ai-admin-button" disabled={Boolean(busy)} onClick={() => void runAction("save")}><Save aria-hidden />{busy === "save" ? "保存中…" : "保存"}</button>
            <button type="button" className="ai-admin-button ai-admin-button--primary" disabled={Boolean(busy)} onClick={() => void runAction("save-test")}><Check aria-hidden />{busy === "save-test" ? "处理中…" : "保存并测试"}</button>
          </footer>
        </article>
      </div>
    </section>
  );
}
