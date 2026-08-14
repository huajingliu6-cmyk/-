"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { GlassSelect } from "@/shell/glass-select";
import {
  btnPrimaryClassName,
  btnSecondaryClassName,
  readJson,
} from "@/auth/ai-admin/shared";
import { RuleHistoryDrawer } from "@/auth/ai-admin/RuleHistoryDrawer";
import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
  ModelConnectionPublic,
  RuleCheckResult,
  TaskRuleDraft,
} from "@/auth/ai-admin/types";
import { resolveCapabilityProfileSlot } from "@/auth/ai-admin/connection-capability-rules";
import {
  capabilitySlug,
  ruleStatusLabel,
  testStatusLabel,
} from "@/auth/ai-admin/types";

type Props = {
  summary: CapabilityRuleSummary;
  connections: ModelConnectionPublic[];
  bindings: AiModelBinding[];
  diag?: CapabilityDiag;
  onBindingsChange: (bindings: AiModelBinding[]) => void;
  onConnectionsRefresh: () => void;
  onSummaryRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** When false, hide the model-connection binder (managed on 能力线路). Default true. */
  showConnectionBinding?: boolean;
};

type RuleDetail = {
  draft: TaskRuleDraft | null;
  effective: { content: string; source: string; version: number | null };
  builtinRule: string;
  publishedVersion: number | null;
};

export function CapabilityRuleCard({
  summary,
  connections,
  bindings,
  diag,
  onBindingsChange,
  onConnectionsRefresh,
  onSummaryRefresh,
  onError,
  onNotice,
  showConnectionBinding = true,
}: Props) {
  const slug = capabilitySlug(summary.capabilityId);
  const planned = summary.status === "planned";
  const profileSlot = resolveCapabilityProfileSlot(summary, diag);

  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<RuleCheckResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const readEditorContent = () =>
    editorRef.current?.value ?? editorContent;

  const binding = profileSlot
    ? bindings.find((b) => b.profileSlot === profileSlot)
    : null;
  const boundConnectionId = binding?.modelConnectionId ?? "";
  const boundConnection = connections.find((c) => c.id === boundConnectionId);

  const connectionOptions = connections
    .filter((c) => c.modality === summary.modality)
    .map((c) => ({
      id: c.id,
      label: `${c.displayName}${c.legacyVirtual ? "（旧版）" : ""}`,
    }));

  const baselineContent =
    detail?.draft?.content ??
    detail?.effective.content ??
    detail?.builtinRule ??
    "";
  const dirty = loaded && detail != null && editorContent !== baselineContent;
  const hasDraft =
    Boolean(detail?.draft) ||
    savedRevision !== null ||
    summary.hasDraft;
  const displaySummary: CapabilityRuleSummary = hasDraft
    ? {
        ...summary,
        hasDraft: true,
        draftRevision: detail?.draft?.revision ?? savedRevision ?? summary.draftRevision,
      }
    : summary;
  const anyBusy = busy != null;

  useEffect(() => {
    if (!expanded || loaded) return;
    let cancelled = false;
    void (async () => {
      setBusy("load");
      try {
        const res = await fetch(
          `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}`,
        );
        const payload = await readJson<RuleDetail & { error?: string }>(res);
        if (!res.ok) throw new Error(payload.error ?? "加载规则失败");
        if (cancelled) return;
        setDetail(payload);
        const initial =
          payload.draft?.content ??
          payload.effective?.content ??
          payload.builtinRule ??
          "";
        setEditorContent(initial);
        setSavedRevision(payload.draft?.revision ?? null);
        setLoaded(true);
      } catch (err) {
        onError(err instanceof Error ? err.message : "加载规则失败");
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, loaded, summary.capabilityId, onError]);

  const applyDetail = (payload: RuleDetail) => {
    setDetail(payload);
    const initial =
      payload.draft?.content ??
      payload.effective?.content ??
      payload.builtinRule ??
      "";
    setEditorContent(initial);
    setSavedRevision(payload.draft?.revision ?? null);
  };

  const reloadDetail = async () => {
    const res = await fetch(
      `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}`,
    );
    const payload = await readJson<RuleDetail & { error?: string }>(res);
    if (!res.ok) throw new Error(payload.error ?? "加载规则失败");
    applyDetail(payload);
    return payload;
  };

  const reportOk = (message: string) => {
    setLocalError("");
    setLocalNotice(message);
    onNotice(message);
  };

  const reportErr = (message: string) => {
    setLocalNotice("");
    setLocalError(message);
    onError(message);
  };

  const persistDraft = async (content: string): Promise<number> => {
    const res = await fetch(
      `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/draft`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          sourceType: "manual",
          expectedRevision: savedRevision,
        }),
      },
    );
    const payload = await readJson<{
      revision?: number;
      error?: string;
      code?: string;
    }>(res);
    if (res.status === 409 || payload.code === "AI_TASK_RULE_REVISION_CONFLICT") {
      await reloadDetail();
      throw new Error("草稿已被更新，已重新加载最新内容，请核对后再次保存");
    }
    if (!res.ok) throw new Error(payload.error ?? "保存草稿失败");
    const revision = payload.revision ?? null;
    setSavedRevision(revision);
    await reloadDetail();
    onSummaryRefresh();
    if (revision == null) {
      throw new Error("保存草稿失败：未返回 revision");
    }
    return revision;
  };

  const onBindConnection = async (connectionId: string) => {
    if (!profileSlot) {
      reportErr("该功能未配置 profile 槽位");
      return;
    }
    setBusy("bind");
    setLocalError("");
    try {
      const res = await fetch("/api/admin/ai-model-bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileSlot,
          modelConnectionId: connectionId || null,
        }),
      });
      const payload = await readJson<{
        binding?: AiModelBinding;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(payload.error ?? "绑定失败");
      if (payload.binding) {
        const exists = bindings.some((b) => b.profileSlot === profileSlot);
        onBindingsChange(
          exists
            ? bindings.map((b) =>
                b.profileSlot === profileSlot ? payload.binding! : b,
              )
            : [...bindings, payload.binding],
        );
      }
      reportOk(`已更新模型绑定：${summary.label}`);
      onConnectionsRefresh();
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setBusy(null);
    }
  };

  const onSaveDraft = async () => {
    const content = readEditorContent();
    setEditorContent(content);
    setBusy("save-draft");
    setCheckResult(null);
    setLocalError("");
    try {
      await persistDraft(content);
      reportOk(`已保存草稿：${summary.label}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "保存草稿失败");
    } finally {
      setBusy(null);
    }
  };

  const onDiscardDraft = async () => {
    if (!window.confirm("确定丢弃当前草稿？")) return;
    setBusy("discard");
    setLocalError("");
    try {
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/draft`,
        { method: "DELETE" },
      );
      const payload = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(payload.error ?? "丢弃草稿失败");
      await reloadDetail();
      onSummaryRefresh();
      reportOk(`已丢弃草稿：${summary.label}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "丢弃草稿失败");
    } finally {
      setBusy(null);
    }
  };

  const onCheck = async () => {
    const content = readEditorContent();
    setEditorContent(content);
    setBusy("check");
    setLocalError("");
    try {
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const payload = await readJson<RuleCheckResult & { error?: string }>(res);
      if (!res.ok) throw new Error(payload.error ?? "校验失败");
      setCheckResult(payload);
      const errCount = payload.errors?.length ?? 0;
      reportOk(
        errCount > 0
          ? `校验完成：${errCount} 个错误`
          : "校验通过，无错误",
      );
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "校验失败");
    } finally {
      setBusy(null);
    }
  };

  const onTestRun = async (confirmPaid = false) => {
    setBusy("test-run");
    setLocalError("");
    try {
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/test-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmPaid, useDraft: true }),
        },
      );
      const payload = await readJson<{
        success?: boolean;
        outputPreview?: string;
        code?: string;
        error?: string;
        note?: string;
      }>(res);
      if (payload.code === "AI_PAID_CONFIRMATION_REQUIRED") {
        const confirmed = window.confirm(
          "非 Mock 试运行可能产生费用。确认继续？",
        );
        if (!confirmed) {
          reportOk("已取消试运行");
          return;
        }
        await onTestRun(true);
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? "试运行失败");
      reportOk(
        payload.outputPreview
          ? `试运行成功（预览）：${payload.outputPreview.slice(0, 120)}…`
          : payload.note ?? "试运行完成",
      );
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "试运行失败");
    } finally {
      setBusy(null);
    }
  };

  const onPublish = async () => {
    if (!window.confirm("发布后将影响线上任务规则，确认发布？")) return;
    setBusy("publish");
    setLocalError("");
    try {
      const content = readEditorContent();
      setEditorContent(content);
      // 发布读取服务端草稿；编辑器有改动或尚无草稿时先落盘
      let revisionForPublish = savedRevision;
      if (dirty || !hasDraft || !detail?.draft) {
        revisionForPublish = await persistDraft(content);
      }
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: revisionForPublish }),
        },
      );
      const payload = await readJson<{
        version?: number;
        error?: string;
        code?: string;
      }>(res);
      if (res.status === 409 || payload.code === "AI_TASK_RULE_REVISION_CONFLICT") {
        await reloadDetail();
        throw new Error("草稿已被更新，已重新加载最新内容，请核对后再次发布");
      }
      if (!res.ok) throw new Error(payload.error ?? "发布失败");
      await reloadDetail();
      onSummaryRefresh();
      reportOk(`已发布 v${payload.version ?? "?"}：${summary.label}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "发布失败");
    } finally {
      setBusy(null);
    }
  };

  const onUseBuiltin = async () => {
    if (!window.confirm("恢复为内置规则并清除自定义发布？")) return;
    setBusy("builtin");
    setLocalError("");
    try {
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/use-builtin`,
        { method: "POST" },
      );
      const payload = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(payload.error ?? "恢复内置失败");
      await reloadDetail();
      onSummaryRefresh();
      reportOk(`已恢复内置规则：${summary.label}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "恢复内置失败");
    } finally {
      setBusy(null);
    }
  };

  const onUploadMd = async (file: File) => {
    setBusy("upload");
    setLocalError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (savedRevision !== null) {
        form.append("expectedRevision", String(savedRevision));
      }
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/import-markdown`,
        { method: "POST", body: form },
      );
      const payload = await readJson<{
        revision?: number;
        error?: string;
        code?: string;
      }>(res);
      if (res.status === 409 || payload.code === "AI_TASK_RULE_REVISION_CONFLICT") {
        await reloadDetail();
        throw new Error("草稿已被更新，已重新加载最新内容，请核对后再次导入");
      }
      if (!res.ok) throw new Error(payload.error ?? "导入失败");
      setSavedRevision(payload.revision ?? null);
      await reloadDetail();
      onSummaryRefresh();
      reportOk(`已导入 Markdown：${file.name}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(null);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const onRollback = async (toVersion: number) => {
    setBusy("rollback");
    setLocalError("");
    try {
      const res = await fetch(
        `/api/admin/ai-task-rules/${encodeURIComponent(summary.capabilityId)}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toVersion }),
        },
      );
      const payload = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(payload.error ?? "回滚失败");
      setHistoryOpen(false);
      await reloadDetail();
      onSummaryRefresh();
      reportOk(`已回滚到 v${toVersion}：${summary.label}`);
    } catch (err) {
      reportErr(err instanceof Error ? err.message : "回滚失败");
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const statusBadge =
    summary.status === "active" ? (
      <span className="text-emerald-400">active</span>
    ) : summary.status === "planned" ? (
      <span className="text-amber-300">planned</span>
    ) : (
      <span className="text-zinc-500">{summary.status}</span>
    );

  return (
    <>
      <div
        className="rounded-xl border border-zinc-800 bg-zinc-900/40"
        data-testid={`ai-rule-card-${slug}`}
      >
        <button
          type="button"
          className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-zinc-100">
                {summary.label}
              </span>
              <span className="ai-admin-rule-capability-id text-[10px] text-zinc-500">
                {summary.capabilityId}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
              <span>{summary.modality}</span>
              <span>{statusBadge}</span>
              {profileSlot ? (
                <span>槽位 {profileSlot}</span>
              ) : (
                <span>无槽位</span>
              )}
              <span>
                模型：{boundConnection?.displayName ?? "（未绑定）"}
              </span>
              <span>
                规则：{ruleStatusLabel(displaySummary)}
                {dirty ? " · 未保存" : ""}
              </span>
              {boundConnection ? (
                <span>
                  连接测试：{testStatusLabel(boundConnection.lastTestStatus)}
                </span>
              ) : null}
            </div>
            {planned ? (
              <p className="mt-1 text-[11px] text-amber-300">功能尚未接线</p>
            ) : null}
            {summary.outputContractConflict ? (
              <p
                className="mt-1 text-[11px] text-rose-300"
                data-testid={`ai-rule-contract-conflict-${slug}`}
                role="alert"
              >
                {summary.outputContractConflictMessage ??
                  "当前已发布规则与固定输出协议冲突，请恢复内置或修正后重新发布。"}
              </p>
            ) : null}
          </div>
        </button>

        {expanded ? (
          <div className="border-t border-zinc-800 px-3 pb-3 pt-2">
            {busy === "load" ? (
              <div className="mb-2 text-xs text-zinc-500">加载规则中…</div>
            ) : null}

            {showConnectionBinding && profileSlot ? (
              <div className="mb-3 max-w-md">
                <GlassSelect
                  label="绑定模型连接"
                  value={boundConnectionId}
                  options={[
                    { id: "", label: "（未绑定）" },
                    ...connectionOptions,
                  ]}
                  onChange={(id) => void onBindConnection(id)}
                  disabled={anyBusy}
                />
              </div>
            ) : null}

            <label className="mb-1 block text-[11px] text-zinc-400">
              任务规则（Markdown / 纯文本）
            </label>
            <textarea
              ref={editorRef}
              className="ai-admin-rule-editor mb-2 min-h-[180px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100 outline-none"
              value={editorContent}
              data-testid={`ai-rule-editor-${slug}`}
              onChange={(e) => setEditorContent(e.target.value)}
            />

            {checkResult ? (
              <div className="mb-2 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-[10px]">
                {[...(checkResult.errors ?? []), ...(checkResult.warnings ?? []), ...(checkResult.infos ?? [])].map(
                  (item, idx) => (
                    <div
                      key={`${item.code}-${idx}`}
                      className={
                        item.severity === "error"
                          ? "text-rose-300"
                          : item.severity === "warning"
                            ? "text-amber-300"
                            : "text-zinc-400"
                      }
                    >
                      [{item.severity}] {item.message}
                    </div>
                  ),
                )}
              </div>
            ) : null}

            {localError ? (
              <div
                className="mb-2 rounded-lg border border-rose-500/30 bg-rose-950/40 px-2.5 py-1.5 text-[11px] text-rose-200"
                role="alert"
              >
                {localError}
              </div>
            ) : null}
            {localNotice ? (
              <div className="mb-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-200">
                {localNotice}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <input
                ref={uploadRef}
                type="file"
                accept=".md,.markdown"
                className="hidden"
                data-testid={`ai-rule-upload-${slug}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onUploadMd(file);
                }}
              />
              <button
                type="button"
                className={btnSecondaryClassName}
                data-testid={`ai-rule-upload-btn-${slug}`}
                disabled={anyBusy}
                onClick={() => uploadRef.current?.click()}
              >
                上传 MD
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                data-testid={`ai-rule-save-draft-${slug}`}
                disabled={anyBusy}
                onClick={() => void onSaveDraft()}
              >
                {busy === "save-draft" ? "保存中…" : "保存草稿"}
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                disabled={anyBusy || !hasDraft}
                onClick={() => void onDiscardDraft()}
              >
                丢弃草稿
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                data-testid={`ai-rule-check-${slug}`}
                disabled={anyBusy}
                onClick={() => void onCheck()}
              >
                {busy === "check" ? "校验中…" : "校验"}
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                disabled={anyBusy}
                onClick={() => void onTestRun()}
              >
                {busy === "test-run" ? "试运行中…" : "试运行"}
              </button>
              <button
                type="button"
                className={btnPrimaryClassName}
                data-testid={`ai-rule-publish-${slug}`}
                disabled={anyBusy}
                onClick={() => void onPublish()}
              >
                {busy === "publish" ? "发布中…" : "发布"}
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                disabled={anyBusy}
                onClick={() => setHistoryOpen(true)}
              >
                历史
              </button>
              <button
                type="button"
                className={btnSecondaryClassName}
                disabled={anyBusy}
                onClick={() => void onUseBuiltin()}
              >
                恢复内置
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <RuleHistoryDrawer
        open={historyOpen}
        capabilityId={summary.capabilityId}
        capabilityLabel={summary.label}
        onClose={() => setHistoryOpen(false)}
        onRollback={onRollback}
      />
    </>
  );
}
