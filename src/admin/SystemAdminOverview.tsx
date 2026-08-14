"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readJson } from "@/auth/ai-admin/shared";
import type {
  AiModelBinding,
  CapabilityDiag,
  ModelConnectionPublic,
} from "@/auth/ai-admin/types";
import { ADMIN_SLOT_CATALOG, MODALITY_GROUP_ORDER } from "@/admin/slot-catalog";
import {
  classifyCapabilityHealth,
  connectionForSlot,
  isAttentionHealth,
  slotRowStatus,
} from "@/admin/slot-status";

type HistoryItem = {
  generationId: string;
  username: string;
  outputKind: string;
  status: string;
  createdAt: string;
  projectName: string;
};

const OUTPUT_KIND_LABELS: Record<string, string> = {
  story: "小故事",
  script: "剧本",
  script_outline: "剧本大纲",
  script_episodes: "剧集正文",
  script_split: "智能分集",
  episode_asset_design: "单集资产设计",
  asset_design_prompt: "素材提示词",
  storyboard_prompt: "分镜提示词",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function ringGradient(parts: Array<{ color: string; count: number }>, total: number): string {
  if (total <= 0) return "conic-gradient(#27272a 0deg 360deg)";
  let cursor = 0;
  const stops: string[] = [];
  for (const part of parts) {
    const next = cursor + (part.count / total) * 360;
    stops.push(`${part.color} ${cursor}deg ${next}deg`);
    cursor = next;
  }
  if (cursor < 360) stops.push(`#27272a ${cursor}deg 360deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

export function SystemAdminOverview() {
  const [diagnostics, setDiagnostics] = useState<CapabilityDiag[]>([]);
  const [connections, setConnections] = useState<ModelConnectionPublic[]>([]);
  const [bindings, setBindings] = useState<AiModelBinding[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [diagRes, connRes, bindRes, histRes] = await Promise.all([
          fetch("/api/admin/api-configs"),
          fetch("/api/admin/model-connections"),
          fetch("/api/admin/ai-model-bindings"),
          fetch("/api/admin/text-generations?page=1&pageSize=8"),
        ]);
        const diagPayload = await readJson<{
          capabilities?: CapabilityDiag[];
          error?: string;
        }>(diagRes);
        const connPayload = await readJson<{
          connections?: ModelConnectionPublic[];
          error?: string;
        }>(connRes);
        const bindPayload = await readJson<{
          bindings?: AiModelBinding[];
          error?: string;
        }>(bindRes);
        const histPayload = await readJson<{
          items?: HistoryItem[];
          error?: string;
        }>(histRes);
        if (!diagRes.ok) throw new Error(diagPayload.error ?? "加载能力诊断失败");
        if (!connRes.ok) throw new Error(connPayload.error ?? "加载模型连接失败");
        if (!bindRes.ok) throw new Error(bindPayload.error ?? "加载接口绑定失败");
        if (!histRes.ok) throw new Error(histPayload.error ?? "加载生成记录失败");
        if (cancelled) return;
        setDiagnostics(diagPayload.capabilities ?? []);
        setConnections(connPayload.connections ?? []);
        setBindings(bindPayload.bindings ?? []);
        setHistory(histPayload.items ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载总览失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const healthCounts = useMemo(() => {
    const counts = { live: 0, mock: 0, blocked: 0, planned: 0 };
    for (const diag of diagnostics) {
      counts[classifyCapabilityHealth(diag)] += 1;
    }
    return counts;
  }, [diagnostics]);

  const failedTests = connections.filter(
    (conn) => conn.lastTestStatus === "failed",
  ).length;

  const modalityReady = useMemo(() => {
    return MODALITY_GROUP_ORDER.map((group) => {
      const slots = ADMIN_SLOT_CATALOG.filter(
        (slot) => slot.modality === group.id && !slot.deprecated,
      );
      const ready = slots.filter((slot) => {
        const status = slotRowStatus(
          connectionForSlot(slot.id, connections, bindings),
        );
        return status === "live" || status === "untested";
      }).length;
      return { ...group, total: slots.length, ready };
    });
  }, [bindings, connections]);

  const attention = diagnostics.filter(isAttentionHealth).slice(0, 8);
  const healthTotal =
    healthCounts.live + healthCounts.mock + healthCounts.blocked + healthCounts.planned;

  return (
    <div data-testid="admin-overview">
      {error ? <p className="admin-error">{error}</p> : null}
      {loading ? <p className="admin-muted">正在汇总平台 AI 状态…</p> : null}

      <div className="admin-stats">
        <Link href="/app/admin/apis?status=live" data-testid="admin-stat-live">
          <span>可运行</span>
          <strong>{healthCounts.live}</strong>
          <small>真实接口已配置</small>
        </Link>
        <Link href="/app/admin/apis?status=mock" data-testid="admin-stat-mock">
          <span>仅演示</span>
          <strong>{healthCounts.mock}</strong>
          <small>仍走本地 Mock</small>
        </Link>
        <Link href="/app/admin/apis?status=blocked" data-testid="admin-stat-blocked">
          <span>缺密钥 / 未绑定</span>
          <strong>{healthCounts.blocked}</strong>
          <small>现在不能给创作台用</small>
        </Link>
        <Link href="/app/admin/apis?status=failed" data-testid="admin-stat-failed">
          <span>最近测试失败</span>
          <strong>{failedTests}</strong>
          <small>连接探测未通过</small>
        </Link>
      </div>

      <div className="admin-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>能力健康</h2>
              <p>按产品功能看现在能不能跑，而不是堆运营数字。</p>
            </div>
          </div>
          <div className="admin-viz">
            <div
              className="admin-ring"
              style={{
                background: ringGradient(
                  [
                    { color: "#6ee7b7", count: healthCounts.live },
                    { color: "#fbbf24", count: healthCounts.mock },
                    { color: "#fda4af", count: healthCounts.blocked },
                    { color: "#94a3b8", count: healthCounts.planned },
                  ],
                  healthTotal,
                ),
              }}
              aria-hidden
            >
              <div className="admin-ring__hole">
                <strong>{healthCounts.live}</strong>
                <span>可运行</span>
              </div>
            </div>
            <ul className="admin-legend">
              <li>
                <i style={{ background: "#6ee7b7" }} />
                可运行 {healthCounts.live}
              </li>
              <li>
                <i style={{ background: "#fbbf24" }} />
                仅演示 {healthCounts.mock}
              </li>
              <li>
                <i style={{ background: "#fda4af" }} />
                阻塞 {healthCounts.blocked}
              </li>
              <li>
                <i style={{ background: "#94a3b8" }} />
                尚未接线 {healthCounts.planned}
              </li>
            </ul>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>模态就绪</h2>
              <p>文本 / 图像 / 音频 / 视频接口有多少已填好。</p>
            </div>
          </div>
          <div className="admin-bars">
            {modalityReady.map((row) => (
              <div key={row.id} className="admin-bar-row">
                <span>{row.label}</span>
                <div className="admin-bar-track">
                  <div
                    className="admin-bar-fill"
                    style={{
                      width: row.total ? `${(row.ready / row.total) * 100}%` : "0%",
                    }}
                  />
                </div>
                <span>
                  {row.ready}/{row.total}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>待处理</h2>
              <p>点一项直接去对应接口填写。</p>
            </div>
          </div>
          {attention.length === 0 ? (
            <p className="admin-empty">没有阻塞项。未接线的规划功能不会列在这里。</p>
          ) : (
            <div className="admin-todo">
              {attention.map((item) => (
                <Link
                  key={item.capabilityId}
                  href={`/app/admin/apis#${item.profileSlotId ?? ""}`}
                  data-testid={`admin-todo-${item.capabilityId}`}
                >
                  <span>
                    {item.label}
                    <small> · {item.health}</small>
                  </span>
                  <span>去配置</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>最近生成</h2>
              <p>最近 8 条文本生成，完整列表在生成记录。</p>
            </div>
            <Link href="/app/admin/history" className="admin-muted">
              查看全部
            </Link>
          </div>
          {history.length === 0 ? (
            <p className="admin-empty">暂无生成记录</p>
          ) : (
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.generationId}>
                      <td>{item.username}</td>
                      <td>{OUTPUT_KIND_LABELS[item.outputKind] ?? item.outputKind}</td>
                      <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                      <td>{formatTime(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

