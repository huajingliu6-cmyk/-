"use client";

import {
  AlertTriangle,
  Check,
  CircleHelp,
  Clock3,
  Minus,
} from "lucide-react";
import type {
  GenerationParameterComparisonView,
  ParameterComparisonRow,
  ParameterRowComparisonStatus,
} from "@/video-generation/parameter-comparison-view";
import { formatParameterRowStatusLabel } from "@/video-generation/parameter-comparison-view";

type Props = {
  view: GenerationParameterComparisonView;
};

function StatusIcon({ status }: { status: ParameterRowComparisonStatus }) {
  const className = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "matching":
      return <Check className={className} aria-hidden />;
    case "mismatch":
      return <AlertTriangle className={className} aria-hidden />;
    case "pending":
      return <Clock3 className={className} aria-hidden />;
    case "notApplicable":
      return <Minus className={className} aria-hidden />;
    case "mockOnly":
      return <CircleHelp className={className} aria-hidden />;
    case "unknown":
    default:
      return <CircleHelp className={className} aria-hidden />;
  }
}

function RowCard({ row }: { row: ParameterComparisonRow }) {
  const statusLabel = formatParameterRowStatusLabel(row.comparisonStatus);
  return (
    <div
      className="min-w-[280px] rounded-xl border border-zinc-200 bg-white p-3"
      role="group"
      aria-label={`${row.label}：${statusLabel}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-zinc-900">
          {row.label}
        </div>
        <div
          className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-600"
          title={row.message}
        >
          <StatusIcon status={row.comparisonStatus} />
          <span>{statusLabel}</span>
        </div>
      </div>
      <dl className="space-y-1.5 text-[11px]">
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-zinc-400">用户请求</dt>
          <dd className="font-medium text-zinc-800">{row.requestedValue}</dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-zinc-400">Provider 返回</dt>
          <dd className="font-medium text-zinc-800">{row.providerValue}</dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-zinc-400">实际视频文件</dt>
          <dd className="font-medium text-zinc-800">{row.actualValue}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        {row.message}
      </p>
    </div>
  );
}

export function ParameterComparisonPanel({ view }: Props) {
  const rows = [view.resolution, view.aspectRatio, view.duration];

  return (
    <section
      className="space-y-2"
      aria-label="请求、Provider 与实际视频参数对照"
    >
      {view.mockBanner && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950"
          role="status"
        >
          <div className="font-semibold">Mock 演示结果</div>
          <div className="mt-0.5">{view.mockBanner}</div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-zinc-900">
            参数对照
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-600">{view.summaryMessage}</p>
        </div>
        <div
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-600"
          title={view.metadataSourceLabel}
        >
          元数据来源：{view.metadataSourceLabel}
        </div>
      </div>

      {/* 宽屏三列；窄屏横向滚动卡片，避免挤压播放器 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
          <caption className="sr-only">
            用户请求、Provider 返回与实际视频文件参数对照表
          </caption>
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                参数
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                用户请求
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                Provider 返回
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                实际视频文件
              </th>
              <th scope="col" className="py-1.5 font-medium">
                状态
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const statusLabel = formatParameterRowStatusLabel(
                row.comparisonStatus,
              );
              return (
                <tr key={row.key} className="border-b border-zinc-100 align-top">
                  <th
                    scope="row"
                    className="py-2 pr-2 font-semibold text-zinc-800"
                  >
                    {row.label}
                  </th>
                  <td className="py-2 pr-2 text-zinc-800">
                    {row.requestedValue}
                  </td>
                  <td className="py-2 pr-2 text-zinc-800">{row.providerValue}</td>
                  <td className="py-2 pr-2 text-zinc-800">{row.actualValue}</td>
                  <td className="py-2">
                    <span
                      className="inline-flex items-center gap-1 text-zinc-600"
                      aria-label={statusLabel}
                      title={row.message}
                    >
                      <StatusIcon status={row.comparisonStatus} />
                      {statusLabel}
                    </span>
                    <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                      {row.message}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
        {rows.map((row) => (
          <RowCard key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
