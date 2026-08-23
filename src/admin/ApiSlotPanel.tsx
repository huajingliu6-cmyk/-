"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GlassSelect } from "@/shell/glass-select";
import { readJson } from "@/auth/ai-admin/shared";
import type {
  AiModelBinding,
  ModelConnectionPublic,
  ModelProviderMode,
} from "@/auth/ai-admin/types";
import { testStatusLabel } from "@/auth/ai-admin/types";
import {
  ADMIN_SLOT_CATALOG,
  ASSET_EXTRACTION_SLOT_IDS,
  MODALITY_GROUP_ORDER,
  TEXT_SIBLING_SLOT_IDS,
  isLegacySlotConnectionId,
  legacySlotConnectionId,
  type AdminSlotDef,
  type AdminSlotId,
} from "@/admin/slot-catalog";
import {
  connectionForSlot,
  providerModeLabel,
  slotRowStatus,
  slotStatusLabel,
  type SlotRowStatus,
} from "@/admin/slot-status";

type SlotDraft = {
  providerMode: ModelProviderMode;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  clearApiKey: boolean;
};

type PublicConfig = {
  id: string;
  provider: ModelProviderMode;
  apiUrl: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  modality: ModelConnectionPublic["modality"];
};

function connectionFromPublicConfig(cfg: PublicConfig): ModelConnectionPublic {
  return {
    id: legacySlotConnectionId(cfg.id as AdminSlotId),
    displayName: cfg.id,
    modality: cfg.modality,
    providerMode: cfg.provider,
    baseUrl: cfg.apiUrl || null,
    modelId: cfg.model || null,
    enabled: cfg.enabled,
    apiKeyConfigured: cfg.hasApiKey,
    apiKeyMasked: cfg.apiKeyMasked,
    lastTestStatus: "untested",
    lastTestedAt: null,
    lastTestMessage: null,
    legacyVirtual: true,
  };
}

function emptyDraft(conn?: ModelConnectionPublic): SlotDraft {
  return {
    providerMode: conn?.providerMode ?? "mock",
    baseUrl: conn?.baseUrl ?? "",
    modelId: conn?.modelId ?? "",
    apiKey: "",
    clearApiKey: false,
  };
}

function providerOptions(modality: AdminSlotDef["modality"]) {
  const options: Array<{ id: ModelProviderMode; label: string }> = [
    { id: "mock", label: "本地演示" },
    { id: "http", label: "真实接口" },
  ];
  if (modality === "video") {
    options.push({ id: "aliyun-wan27", label: "万相" });
  }
  return options;
}

export function ApiSlotPanel() {
  const searchParams = useSearchParams();
  const statusFilter = (searchParams.get("status") ?? "") as
    | SlotRowStatus
    | "blocked"
    | "";

  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [bindings, setBindings] = useState<AiModelBinding[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [connRes, bindRes, cfgRes] = await Promise.all([
        fetch("/api/admin/model-connections"),
        fetch("/api/admin/ai-model-bindings"),
        fetch("/api/admin/api-configs"),
      ]);
      const connPayload = await readJson<{
        connections?: ModelConnectionPublic[];
        error?: string;
      }>(connRes);
      const bindPayload = await readJson<{
        bindings?: AiModelBinding[];
        error?: string;
      }>(bindRes);
      const cfgPayload = await readJson<{
        configs?: PublicConfig[];
        error?: string;
      }>(cfgRes);
      if (!connRes.ok) throw new Error(connPayload.error ?? "加载模型连接失败");
      if (!bindRes.ok) throw new Error(bindPayload.error ?? "加载接口绑定失败");
      if (!cfgRes.ok) throw new Error(cfgPayload.error ?? "加载接口配置失败");
      const list = [...(connPayload.connections ?? [])];
      const nextBindings = bindPayload.bindings ?? [];
      for (const slot of ADMIN_SLOT_CATALOG) {
        if (connectionForSlot(slot.id, list, nextBindings)) continue;
        const cfg = (cfgPayload.configs ?? []).find((item) => item.id === slot.id);
        if (cfg) list.push(connectionFromPublicConfig(cfg));
      }
      setConnections(list);
      setBindings(nextBindings);
      const nextDrafts: Record<string, SlotDraft> = {};
      for (const slot of ADMIN_SLOT_CATALOG) {
        nextDrafts[slot.id] = emptyDraft(
          connectionForSlot(slot.id, list, nextBindings),
        );
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 API 接口失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const slot = ADMIN_SLOT_CATALOG.find((item) => item.id === hash);
    if (!slot) return;
    if (slot.deprecated) setShowDeprecated(true);
    setExpandedId(slot.id);
    requestAnimationFrame(() => {
      document.getElementById(`slot-${slot.id}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }, [loading]);

  const connectionIdForSlot = (slotId: AdminSlotId) => {
    const conn = connectionForSlot(slotId, connections, bindings);
    return conn?.id ?? legacySlotConnectionId(slotId);
  };

  const persistSlot = async (
    slot: AdminSlotDef,
    patch: Partial<SlotDraft> & { enabled?: boolean },
  ) => {
    const draft = { ...drafts[slot.id]!, ...patch };
    const connectionId = connectionIdForSlot(slot.id);
    const current = connectionForSlot(slot.id, connections, bindings);
    const res = await fetch(
      `/api/admin/model-connections/${encodeURIComponent(connectionId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: isLegacySlotConnectionId(connectionId)
            ? slot.label
            : (current?.displayName ?? slot.label),
          providerMode: draft.providerMode,
          baseUrl: draft.baseUrl.trim() || null,
          modelId: draft.modelId.trim() || null,
          enabled: patch.enabled,
          apiKey: draft.apiKey.trim() || undefined,
          clearApiKey: draft.clearApiKey,
        }),
      },
    );
    const payload = await readJson<{
      connection?: ModelConnectionPublic;
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(payload.error ?? "保存失败");
    return payload.connection;
  };

  const onSave = async (slot: AdminSlotDef) => {
    setBusyId(slot.id);
    setError("");
    setNotice("");
    try {
      await persistSlot(slot, {});
      setNotice(`已保存：${slot.label}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusyId(null);
    }
  };

  const onToggleEnabled = async (slot: AdminSlotDef, enabled: boolean) => {
    setBusyId(`enable-${slot.id}`);
    setError("");
    setNotice("");
    try {
      await persistSlot(slot, { enabled });
      setNotice(`${slot.label}已${enabled ? "启用" : "停用"}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusyId(null);
    }
  };

  const runTest = async (slot: AdminSlotDef, confirmPaid = false) => {
    const connectionId = connectionIdForSlot(slot.id);
    setBusyId(`test-${slot.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch(
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
        await runTest(slot, true);
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? payload.note ?? "测试失败");
      setNotice(
        payload.success
          ? `${slot.label}测试成功${payload.note ? `（${payload.note}）` : ""}`
          : `${slot.label}测试失败：${payload.note ?? payload.errorCode ?? ""}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setBusyId(null);
    }
  };

  const onApplyToAssetExtractionSibling = async (slot: AdminSlotDef) => {
    const source = connectionForSlot(slot.id, connections, bindings);
    if (!source) {
      setError("请先保存当前接口，再同步到另一阶段");
      return;
    }
    const siblings = ASSET_EXTRACTION_SLOT_IDS.filter((id) => id !== slot.id);
    setBusyId(`copy-extract-${slot.id}`);
    setError("");
    setNotice("");
    try {
      const draft = drafts[slot.id]!;
      for (const siblingId of siblings) {
        const sibling = ADMIN_SLOT_CATALOG.find((item) => item.id === siblingId)!;
        if (!isLegacySlotConnectionId(source.id)) {
          const res = await fetch("/api/admin/ai-model-bindings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profileSlot: siblingId,
              modelConnectionId: source.id,
            }),
          });
          const payload = await readJson<{ error?: string }>(res);
          if (!res.ok) throw new Error(payload.error ?? "同步绑定失败");
          continue;
        }
        const targetId = connectionIdForSlot(siblingId);
        const res = await fetch(
          `/api/admin/model-connections/${encodeURIComponent(targetId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              displayName: sibling.label,
              providerMode: draft.providerMode,
              baseUrl: draft.baseUrl.trim() || source.baseUrl,
              modelId: draft.modelId.trim() || source.modelId,
              apiKey: draft.apiKey.trim() || undefined,
            }),
          },
        );
        const payload = await readJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(payload.error ?? `同步到${sibling.label}失败`);
      }
      setNotice(`已将「${slot.label}」的模型配置同步到另一提取阶段（任务规则仍分开展开编辑）`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusyId(null);
    }
  };

  const onApplyToTextSiblings = async (slot: AdminSlotDef) => {
    const source = connectionForSlot(slot.id, connections, bindings);
    if (!source) {
      setError("请先保存当前接口，再套用到其他文本接口");
      return;
    }
    const siblings = TEXT_SIBLING_SLOT_IDS.filter((id) => id !== slot.id);
    setBusyId(`copy-${slot.id}`);
    setError("");
    setNotice("");
    try {
      if (!isLegacySlotConnectionId(source.id)) {
        for (const siblingId of siblings) {
          const res = await fetch("/api/admin/ai-model-bindings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profileSlot: siblingId,
              modelConnectionId: source.id,
            }),
          });
          const payload = await readJson<{ error?: string }>(res);
          if (!res.ok) throw new Error(payload.error ?? "套用绑定失败");
        }
      } else {
        const draft = drafts[slot.id]!;
        for (const siblingId of siblings) {
          const sibling = ADMIN_SLOT_CATALOG.find((item) => item.id === siblingId)!;
          const targetId = connectionIdForSlot(siblingId);
          const res = await fetch(
            `/api/admin/model-connections/${encodeURIComponent(targetId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                displayName: sibling.label,
                providerMode: draft.providerMode,
                baseUrl: draft.baseUrl.trim() || source.baseUrl,
                modelId: draft.modelId.trim() || source.modelId,
                apiKey: draft.apiKey.trim() || undefined,
              }),
            },
          );
          const payload = await readJson<{ error?: string }>(res);
          if (!res.ok) throw new Error(payload.error ?? `套用到${sibling.label}失败`);
        }
      }
      setNotice(`已将「${slot.label}」套用到其他文本接口`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "套用失败");
    } finally {
      setBusyId(null);
    }
  };

  const onReuseConnection = async (
    slot: AdminSlotDef,
    modelConnectionId: string | null,
  ) => {
    setBusyId(`bind-${slot.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/ai-model-bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileSlot: slot.id,
          modelConnectionId,
        }),
      });
      const payload = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(payload.error ?? "绑定失败");
      setNotice(`已更新「${slot.label}」使用的连接`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setBusyId(null);
    }
  };

  const visibleGroups = useMemo(() => {
    return MODALITY_GROUP_ORDER.map((group) => {
      const slots = ADMIN_SLOT_CATALOG.filter((slot) => {
        if (slot.modality !== group.id) return false;
        if (slot.deprecated && !showDeprecated) return false;
        const conn = connectionForSlot(slot.id, connections, bindings);
        const status = slotRowStatus(conn);
        if (!statusFilter) return true;
        if (statusFilter === "blocked") {
          return (
            status === "missing_key" ||
            status === "unconfigured" ||
            status === "disabled"
          );
        }
        return status === statusFilter;
      });
      return { ...group, slots };
    }).filter((group) => group.slots.length > 0);
  }, [bindings, connections, showDeprecated, statusFilter]);

  return (
    <div data-testid="admin-api-slots">
      <p className="admin-muted" style={{ marginBottom: 14 }}>
        每一行对应一个创作功能。展开后只需填写地址、密钥和模型名；密钥不会明文回传，留空表示保持原密钥。
      </p>
      {error ? <p className="admin-error">{error}</p> : null}
      {notice ? <p className="admin-note">{notice}</p> : null}
      {loading ? <p className="admin-muted">加载接口配置…</p> : null}

      <div className="admin-checks" style={{ marginBottom: 14 }}>
        <label>
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(event) => setShowDeprecated(event.target.checked)}
          />{" "}
          显示已停用接口
        </label>
      </div>

      {visibleGroups.map((group) => (
        <section key={group.id} className="admin-slot-group">
          <h2>{group.label}</h2>
          {group.slots.map((slot) => {
            const conn = connectionForSlot(slot.id, connections, bindings);
            const status = slotRowStatus(conn);
            const draft = drafts[slot.id] ?? emptyDraft(conn);
            const expanded = expandedId === slot.id;
            const reuseOptions = connections
              .filter(
                (item) =>
                  item.modality === slot.modality &&
                  !isLegacySlotConnectionId(item.id),
              )
              .map((item) => ({
                id: item.id,
                label: item.displayName,
              }));
            return (
              <article
                key={slot.id}
                id={`slot-${slot.id}`}
                className={`admin-slot-row${expanded ? " is-open" : ""}${
                  slot.deprecated ? " is-deprecated" : ""
                }`}
                data-testid={`admin-slot-${slot.id}`}
              >
                <div className="admin-slot-head">
                  <button
                    type="button"
                    className="admin-slot-name"
                    onClick={() =>
                      setExpandedId((current) =>
                        current === slot.id ? null : slot.id,
                      )
                    }
                  >
                    <strong>{slot.label}</strong>
                    <small>{slot.description}</small>
                  </button>
                  <span className={`admin-chip admin-chip--${status}`}>
                    {slotStatusLabel(status)}
                  </span>
                  <span className="admin-muted">
                    {conn ? providerModeLabel(conn.providerMode) : "—"}
                  </span>
                  <span className="admin-muted">
                    {conn?.apiKeyConfigured ? conn.apiKeyMasked : "未填"}
                  </span>
                  <span className="admin-muted">
                    {conn ? testStatusLabel(conn.lastTestStatus) : "—"}
                    {conn?.lastTestMessage ? ` · ${conn.lastTestMessage}` : ""}
                  </span>
                  <div className="admin-slot-actions">
                    <button
                      type="button"
                      disabled={busyId === `test-${slot.id}` || !conn}
                      onClick={() => void runTest(slot)}
                    >
                      {busyId === `test-${slot.id}` ? "测试中…" : "测试"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === `enable-${slot.id}` || !conn}
                      onClick={() =>
                        void onToggleEnabled(slot, !(conn?.enabled ?? true))
                      }
                    >
                      {conn?.enabled === false ? "启用" : "停用"}
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() =>
                        setExpandedId((current) =>
                          current === slot.id ? null : slot.id,
                        )
                      }
                    >
                      {expanded ? "收起" : "填写"}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="admin-slot-editor">
                    <div className="admin-slot-fields">
                      <GlassSelect
                        label="模式"
                        value={draft.providerMode}
                        options={providerOptions(slot.modality)}
                        onChange={(id) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [slot.id]: {
                              ...draft,
                              providerMode: id as ModelProviderMode,
                            },
                          }))
                        }
                      />
                      <label>
                        模型 / 接入点 ID
                        <input
                          value={draft.modelId}
                          placeholder="模型名或 ep-xxxx"
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [slot.id]: { ...draft, modelId: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        API 地址
                        <input
                          value={draft.baseUrl}
                          placeholder="https://api.example.com/compatible-mode/v1"
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [slot.id]: { ...draft, baseUrl: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        API Key
                        <input
                          type="password"
                          value={draft.apiKey}
                          disabled={draft.clearApiKey}
                          placeholder={
                            conn?.apiKeyConfigured
                              ? `已配置 ${conn.apiKeyMasked}，留空则保持不变`
                              : "粘贴 API Key（将加密落盘）"
                          }
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [slot.id]: { ...draft, apiKey: event.target.value },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="admin-checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.clearApiKey}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [slot.id]: {
                                ...draft,
                                clearApiKey: event.target.checked,
                                apiKey: event.target.checked ? "" : draft.apiKey,
                              },
                            }))
                          }
                        />
                        清除已保存密钥
                      </label>
                    </div>
                    <div className="admin-slot-actions">
                      {ASSET_EXTRACTION_SLOT_IDS.includes(slot.id) ? (
                        <button
                          type="button"
                          disabled={busyId === `copy-extract-${slot.id}`}
                          onClick={() => void onApplyToAssetExtractionSibling(slot)}
                        >
                          {busyId === `copy-extract-${slot.id}`
                            ? "同步中…"
                            : "同步到另一提取阶段"}
                        </button>
                      ) : null}
                      {slot.modality === "text" && !slot.deprecated ? (
                        <button
                          type="button"
                          disabled={busyId === `copy-${slot.id}`}
                          onClick={() => void onApplyToTextSiblings(slot)}
                        >
                          {busyId === `copy-${slot.id}`
                            ? "套用中…"
                            : "套用到其他文本接口"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="is-primary"
                        disabled={busyId === slot.id}
                        onClick={() => void onSave(slot)}
                      >
                        {busyId === slot.id ? "保存中…" : "保存"}
                      </button>
                    </div>
                    <details className="admin-advanced">
                      <summary>高级：复用已有连接</summary>
                      <div style={{ marginTop: 10 }}>
                        <GlassSelect
                          label="使用连接"
                          value={
                            conn && !isLegacySlotConnectionId(conn.id)
                              ? conn.id
                              : "__legacy__"
                          }
                          options={[
                            { id: "__legacy__", label: "本接口独立配置" },
                            ...reuseOptions,
                          ]}
                          onChange={(id) =>
                            void onReuseConnection(
                              slot,
                              id === "__legacy__" ? null : id,
                            )
                          }
                        />
                      </div>
                    </details>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
