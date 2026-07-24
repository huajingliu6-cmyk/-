"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { BuildVideoGenerationInputResult } from "@/workflow/lib/build-video-generation-input";
import type { ReferenceMediaSelectionView } from "@/workflow/lib/reference-media-selection-view";
import type {
  ModelCapability,
  VideoAspectRatio,
  VideoProviderId,
  VideoResolution,
  WanGenerationMode,
} from "@/video-generation/types";

type PublicConfig = {
  providerId: VideoProviderId;
  allowPaidGeneration: boolean;
  hasApiKey: boolean;
  hasWorkspaceId: boolean;
  t2vModelId: string;
  r2vModelId: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  config: PublicConfig | null;
  capability: ModelCapability | null;
  mode: WanGenerationMode;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio | null;
  durationSeconds: number;
  built: BuildVideoGenerationInputResult | null;
  selectionView: ReferenceMediaSelectionView | null;
  onManageReferences: () => void;
  onConfirmMock: () => void;
  onConfirmPaid: () => void;
};

export function GenerationConfirmationDrawer({
  open,
  onClose,
  config,
  capability,
  mode,
  resolution,
  aspectRatio,
  durationSeconds,
  built,
  selectionView,
  onManageReferences,
  onConfirmMock,
  onConfirmPaid,
}: Props) {
  if (!open) return null;

  const providerId = config?.providerId ?? "mock";
  const isMock = providerId === "mock";
  const paidEnabled = Boolean(config?.allowPaidGeneration);
  const keysReady = Boolean(config?.hasApiKey && config?.hasWorkspaceId);
  const canPaid = !isMock && paidEnabled && keysReady;

  const selectionBlocking = Boolean(
    !selectionView?.capabilityLoaded ||
      !selectionView.canGenerate ||
      (built && !built.ok),
  );

  const ordered =
    built && built.ok ? built.input.orderedReferenceMedia : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className="nodrag nopan nowheel flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">生成确认</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              请核对 Provider、参数与最终发送素材后再提交
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-auto px-4 py-3 text-[12px] text-zinc-700">
          <Row label="Provider" value={providerId} />
          <Row label="模型 ID" value={capability?.modelId ?? "—"} />
          <Row
            label="模式"
            value={mode === "textToVideo" ? "文生视频" : "参考生视频"}
          />
          <Row label="分辨率" value={resolution} />
          <Row
            label="比例"
            value={
              aspectRatio === null
                ? "由首帧决定（不发送 ratio）"
                : aspectRatio
            }
          />
          <Row label="时长" value={`${durationSeconds} 秒`} />
          <Row
            label="参考上限"
            value={
              selectionView?.limit != null
                ? String(selectionView.limit)
                : "模型能力尚未加载"
            }
          />

          <Section title="最终发送顺序">
            {ordered.length === 0 ? (
              "无普通参考素材"
            ) : (
              <ol className="list-decimal space-y-0.5 pl-4">
                {ordered.map((r, i) => (
                  <li key={`${r.assetId}-${i}`}>
                    {r.label}（{r.kind}）
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="首帧">
            {selectionView?.firstFrame
              ? `${selectionView.firstFrame.label} · ${selectionView.firstFrame.sourceNodeTitle}`
              : built?.ok && built.input.firstFrame
                ? built.input.firstFrame.label
                : "无"}
          </Section>

          {selectionView && selectionView.excluded.length > 0 ? (
            <Section title="未发送 / 排除">
              <ul className="space-y-0.5">
                {selectionView.excluded.map((ex) => (
                  <li key={ex.candidate.assetId}>
                    {ex.candidate.label}：{ex.reason}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {built && built.ok && built.unsupportedAudioLabels.length > 0 ? (
            <Section title="不受当前模型支持的音频">
              {built.unsupportedAudioLabels.join("；")}
            </Section>
          ) : null}

          {selectionView && !selectionView.capabilityLoaded ? (
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">
              模型能力尚未加载，暂时无法确认参考素材上限。
            </div>
          ) : null}

          {selectionView && selectionView.blockingErrors.length > 0 ? (
            <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-700">
              {selectionView.blockingErrors.join("；")}
            </div>
          ) : null}

          {built && !built.ok ? (
            <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-700">
              {built.errors.join("；")}
            </div>
          ) : null}

          {selectionBlocking ? (
            <button
              type="button"
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-[11px] text-amber-900"
              onClick={onManageReferences}
            >
              选择未完成：打开「管理参考素材」
            </button>
          ) : null}

          <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            {isMock
              ? "当前为 Mock 模式，不会产生费用，结果将标记为演示视频。"
              : paidEnabled
                ? "真实付费生成已启用：确认后将调用阿里云百炼万相接口并产生费用。"
                : "真实付费生成未启用（ALLOW_PAID_GENERATION=false）。"}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-50"
            onClick={onClose}
          >
            取消
          </button>
          {isMock ? (
            <button
              type="button"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              onClick={onConfirmMock}
              disabled={selectionBlocking}
            >
              运行 Mock
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canPaid || selectionBlocking}
              title={
                !paidEnabled
                  ? "ALLOW_PAID_GENERATION 未启用"
                  : !keysReady
                    ? "缺少 API Key 或 Workspace ID"
                    : "确认付费生成"
              }
              onClick={onConfirmPaid}
            >
              确认付费生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-zinc-400">{label}</span>
      <span className="break-all font-medium text-zinc-800">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-zinc-400">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
