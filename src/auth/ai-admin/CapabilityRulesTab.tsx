"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineNotices, readJson, SectionTitle } from "@/auth/ai-admin/shared";
import { CapabilityRuleCard } from "@/auth/ai-admin/CapabilityRuleCard";
import { filterCapabilityRulesForConnection } from "@/auth/ai-admin/connection-capability-rules";
import type { AdminView } from "@/auth/ai-admin/admin-view";
import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
  ModelConnectionPublic,
  ProfileSlotOption,
} from "@/auth/ai-admin/types";

type Props = {
  active: boolean;
  connectionId?: string | null;
  embedded?: boolean;
  onNavigate?: (view: AdminView) => void;
};

export function CapabilityRulesTab({
  active,
  connectionId = null,
  embedded = false,
  onNavigate,
}: Props) {
  const [capabilities, setCapabilities] = useState<CapabilityRuleSummary[]>([]);
  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [bindings, setBindings] = useState<AiModelBinding[]>([]);
  const [diagnostics, setDiagnostics] = useState<CapabilityDiag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [migrationHint, setMigrationHint] = useState("");

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [rulesRes, connRes, bindRes, diagRes] = await Promise.all([
        fetch("/api/admin/ai-task-rules"),
        fetch("/api/admin/model-connections"),
        fetch("/api/admin/ai-model-bindings"),
        fetch("/api/admin/api-configs"),
      ]);

      const rulesPayload = await readJson<{
        capabilities?: CapabilityRuleSummary[];
        migrationHint?: string | null;
        error?: string;
      }>(rulesRes);
      const connPayload = await readJson<{
        connections?: ModelConnectionPublic[];
        error?: string;
      }>(connRes);
      const bindPayload = await readJson<{
        bindings?: AiModelBinding[];
        slots?: ProfileSlotOption[];
        error?: string;
      }>(bindRes);
      const diagPayload = await readJson<{
        capabilities?: CapabilityDiag[];
        error?: string;
      }>(diagRes);

      if (!rulesRes.ok) {
        throw new Error(rulesPayload.error ?? "加载任务规则失败");
      }
      if (!connRes.ok) {
        throw new Error(connPayload.error ?? "加载模型连接失败");
      }
      if (!bindRes.ok) {
        throw new Error(bindPayload.error ?? "加载模型绑定失败");
      }
      if (!diagRes.ok) {
        throw new Error(diagPayload.error ?? "加载能力诊断失败");
      }

      setCapabilities(rulesPayload.capabilities ?? []);
      setMigrationHint(rulesPayload.migrationHint?.trim() || "");
      setConnections(connPayload.connections ?? []);
      setBindings(bindPayload.bindings ?? []);
      setDiagnostics(diagPayload.capabilities ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Fetch admin data when tab becomes active (external sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-activate
    void loadAll();
  }, [active, loadAll]);

  const refreshConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/model-connections");
      const payload = await readJson<{
        connections?: ModelConnectionPublic[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(payload.error ?? "刷新连接失败");
      setConnections(payload.connections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新连接失败");
    }
  }, []);

  const refreshSummaries = useCallback(() => {
    void loadAll({ silent: true });
  }, [loadAll]);

  const diagFor = (capabilityId: string) =>
    diagnostics.find((d) => d.capabilityId === capabilityId);

  const visibleCapabilities = useMemo(() => {
    if (!embedded) return capabilities;
    return filterCapabilityRulesForConnection(
      capabilities,
      diagnostics,
      bindings,
      connectionId,
    );
  }, [embedded, capabilities, diagnostics, bindings, connectionId]);

  const showEmptyBoundState =
    embedded && Boolean(connectionId) && !loading && visibleCapabilities.length === 0;

  return (
    <div
      className={embedded ? "ai-admin-connection-rules-tab" : "space-y-4"}
      data-testid={
        embedded ? "admin-connection-capability-rules" : "admin-capability-rules"
      }
    >
      {!embedded ? (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          为各 AI 功能绑定模型连接并管理任务规则。planned
          功能显示「功能尚未接线」，仍可编辑规则与绑定，但不会声称已激活运行。
        </p>
      ) : null}

      <InlineNotices
        error={error}
        notice={notice}
        onDismissError={() => setError("")}
        onDismissNotice={() => setNotice("")}
      />

      {migrationHint ? (
        <div
          className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-[11px] leading-relaxed text-amber-100"
          role="status"
          data-testid="admin-task-rule-migration-hint"
        >
          <p className="m-0 font-medium">任务规则归属修复提示</p>
          <p className="mt-1 mb-0">{migrationHint}</p>
          <p className="mt-1 mb-0 text-amber-200/80">
            处理建议：打开「剧集资产设计提取」确认已恢复内置或专用资产提取规则；打开「素材提示词生成」确认提示词规则；若两边仍冲突，对资产提取使用「恢复内置」，再把提示词规则发布到正确能力。
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="text-xs text-zinc-500">加载功能规则中…</div>
      ) : null}

      {!embedded ? <SectionTitle>功能绑定与任务规则</SectionTitle> : null}

      {showEmptyBoundState ? (
        <div className="ai-admin-connection-rules__empty" data-testid="admin-connection-rules-empty">
          <p>当前连接尚未关联业务能力，请先到能力线路完成绑定。</p>
          {onNavigate ? (
            <button
              type="button"
              className="ai-admin-button"
              data-testid="admin-goto-capability-routes"
              onClick={() => onNavigate("routes")}
            >
              前往能力线路
            </button>
          ) : null}
        </div>
      ) : (
        <div className="ai-admin-connection-rules__list space-y-2">
          {visibleCapabilities.map((cap) => (
            <CapabilityRuleCard
              key={cap.capabilityId}
              summary={cap}
              connections={connections}
              bindings={bindings}
              diag={diagFor(cap.capabilityId)}
              onBindingsChange={setBindings}
              onConnectionsRefresh={() => void refreshConnections()}
              onSummaryRefresh={refreshSummaries}
              onError={setError}
              onNotice={setNotice}
              showConnectionBinding={!embedded}
            />
          ))}
        </div>
      )}
    </div>
  );
}
