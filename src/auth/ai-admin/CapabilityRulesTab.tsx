"use client";

import { useCallback, useEffect, useState } from "react";
import { InlineNotices, readJson, SectionTitle } from "@/auth/ai-admin/shared";
import { CapabilityRuleCard } from "@/auth/ai-admin/CapabilityRuleCard";
import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
  ModelConnectionPublic,
  ProfileSlotOption,
} from "@/auth/ai-admin/types";

type Props = {
  active: boolean;
};

export function CapabilityRulesTab({ active }: Props) {
  const [capabilities, setCapabilities] = useState<CapabilityRuleSummary[]>([]);
  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [bindings, setBindings] = useState<AiModelBinding[]>([]);
  const [diagnostics, setDiagnostics] = useState<CapabilityDiag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-zinc-500">
        为各 AI 功能绑定模型连接并管理任务规则。planned
        功能显示「功能尚未接线」，仍可编辑规则与绑定，但不会声称已激活运行。
      </p>

      <InlineNotices
        error={error}
        notice={notice}
        onDismissError={() => setError("")}
        onDismissNotice={() => setNotice("")}
      />

      {loading ? (
        <div className="text-xs text-zinc-500">加载功能规则中…</div>
      ) : null}

      <SectionTitle>功能绑定与任务规则</SectionTitle>

      <div className="space-y-2">
        {capabilities.map((cap) => (
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
          />
        ))}
      </div>
    </div>
  );
}
