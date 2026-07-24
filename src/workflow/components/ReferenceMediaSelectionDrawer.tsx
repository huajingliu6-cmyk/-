"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  ImageIcon,
  X,
} from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import {
  canMoveDraftSelection,
  createReferenceMediaSelectionDraft,
  moveDraftSelection,
  removeInvalidDraftIds,
  switchDraftToAuto,
  switchDraftToManual,
  toggleDraftSelection,
  type ReferenceMediaSelectionDraft,
} from "@/workflow/lib/reference-media-selection-draft";
import { canSaveReferenceMediaDraft } from "@/workflow/lib/reference-media-selection-view";
import { prepareReferenceMediaSelectionBundle } from "@/workflow/lib/prepare-reference-media-selection";
import { resolveReferenceMediaSelection } from "@/video-generation/reference-media";
import type { ModelCapability, VideoProviderId } from "@/video-generation/types";
import type { WorkflowDocument, VideoShotNode } from "@/workflow/types";
import { useWorkflowStore } from "@/workflow/store";

type Props = {
  open: boolean;
  videoShotNodeId: string;
  document: WorkflowDocument;
  capability: ModelCapability | null;
  providerId: VideoProviderId | string;
  onClose: () => void;
  onRequestFocusReturn?: () => void;
  onJumpToNode?: (nodeId: string) => void;
};

function readShotSelection(document: WorkflowDocument, nodeId: string) {
  const shot = document.nodes.find(
    (n): n is VideoShotNode => n.id === nodeId && n.type === "videoShot",
  );
  return {
    mode:
      shot?.data.referenceSelectionMode === "manual"
        ? ("manual" as const)
        : ("auto" as const),
    selectedReferenceAssetIds: shot?.data.selectedReferenceAssetIds ?? [],
  };
}

export function ReferenceMediaSelectionDrawer(props: Props) {
  if (!props.open) return null;
  const projectId = useWorkflowStore.getState().projectId;
  return (
    <ReferenceMediaSelectionDrawerSession
      key={`${projectId}:${props.videoShotNodeId}`}
      {...props}
    />
  );
}

function ReferenceMediaSelectionDrawerSession({
  videoShotNodeId,
  document,
  capability,
  providerId,
  onClose,
  onRequestFocusReturn,
  onJumpToNode,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const setReferenceMediaSelection = useWorkflowStore(
    (s) => s.setReferenceMediaSelection,
  );
  const projectId = useWorkflowStore((s) => s.projectId);

  const [draft, setDraft] = useState<ReferenceMediaSelectionDraft>(() => {
    const doc = useWorkflowStore.getState().document;
    const snap = readShotSelection(doc, videoShotNodeId);
    return createReferenceMediaSelectionDraft({
      mode: snap.mode,
      selectedReferenceAssetIds: snap.selectedReferenceAssetIds,
    });
  });
  const [sessionKey] = useState(() => `${projectId}:${videoShotNodeId}`);
  const [saveError, setSaveError] = useState("");

  const handleCancel = useCallback(() => {
    onClose();
    onRequestFocusReturn?.();
  }, [onClose, onRequestFocusReturn]);

  useEffect(() => {
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCancel]);

  const liveBundle = useMemo(
    () =>
      prepareReferenceMediaSelectionBundle({
        document,
        videoShotNodeId,
        capability,
        mode: draft.draftMode,
        selectedReferenceAssetIds:
          draft.draftMode === "manual" ? draft.draftSelectedIds : [],
      }),
    [document, videoShotNodeId, capability, draft],
  );

  const { candidates, firstFrameResult, view } = liveBundle;
  const limit = capability?.maxReferenceMedia ?? null;
  const firstFrameAssetId =
    firstFrameResult.ok && firstFrameResult.firstFrame
      ? firstFrameResult.firstFrame.assetId
      : null;

  const autoResolved =
    capability != null
      ? resolveReferenceMediaSelection({
          candidates,
          selectionMode: "auto",
          selectedReferenceAssetIds: [],
          capability,
          firstFrameAssetId,
        })
      : null;

  const draftResolved =
    capability != null && draft.draftMode === "manual"
      ? resolveReferenceMediaSelection({
          candidates,
          selectionMode: "manual",
          selectedReferenceAssetIds: draft.draftSelectedIds,
          capability,
          firstFrameAssetId,
        })
      : draft.draftMode === "auto"
        ? autoResolved
        : null;

  const invalidDraftIds = draftResolved?.invalidSelectedIds ?? [];
  const selectedCount =
    draft.draftMode === "auto"
      ? (autoResolved?.selected.length ?? 0)
      : draft.draftSelectedIds.length;

  const canSave = canSaveReferenceMediaDraft({
    capabilityLoaded: Boolean(capability),
    mode: draft.draftMode,
    eligibleCount: view.eligibleCount,
    limit,
    draftSelectedIds: draft.draftSelectedIds,
    invalidDraftIds,
    resolvedErrors: draftResolved?.validationErrors ?? [],
    requiresManualSelection: Boolean(
      draft.draftMode === "auto" && autoResolved?.requiresManualSelection,
    ),
  });

  function handleSave() {
    if (!capability || !canSave) {
      setSaveError(
        !capability
          ? "模型能力尚未加载，暂时无法确认参考素材上限。"
          : draftResolved?.validationErrors[0]?.message ||
              "当前选择无法保存，请先修正错误。",
      );
      return;
    }
    const expectedKey = `${projectId}:${videoShotNodeId}`;
    if (sessionKey !== expectedKey) {
      setSaveError("选择会话已失效，请重新打开管理面板。");
      return;
    }
    const idsToSave =
      draft.draftMode === "auto" ? [] : [...draft.draftSelectedIds];
    setReferenceMediaSelection(videoShotNodeId, draft.draftMode, idsToSave);
    onClose();
    onRequestFocusReturn?.();
  }

  const atLimit =
    draft.draftMode === "manual" &&
    limit != null &&
    draft.draftSelectedIds.length >= limit;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3 sm:items-center"
      onMouseDown={handleCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="nodrag nopan nowheel flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-zinc-900">
              管理参考素材
            </h2>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                Provider：{providerId}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                模型：{capability?.modelId ?? "未加载"}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                模式：{draft.draftMode === "auto" ? "自动" : "手动"}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                已选择 {selectedCount}
                {limit != null ? ` / ${limit}` : ""}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                候选 {view.candidateCount}（合法 {view.eligibleCount}）
              </span>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100"
            aria-label="关闭并取消"
            onClick={handleCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-4 py-3 text-[12px] text-zinc-700">
          {!capability ? (
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">
              模型能力尚未加载，暂时无法确认参考素材上限。
            </div>
          ) : null}

          {(draftResolved?.validationErrors.length ?? 0) > 0 ||
          (autoResolved?.requiresManualSelection &&
            draft.draftMode === "auto") ? (
            <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-700">
              {draft.draftMode === "auto" &&
              autoResolved?.requiresManualSelection
                ? `当前有 ${view.eligibleCount} 项合法参考素材，模型最多支持 ${limit} 项，请切换为手动选择。`
                : draftResolved?.validationErrors
                    .map((e) => e.message)
                    .join("；")}
            </div>
          ) : null}

          {saveError ? (
            <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-700">
              {saveError}
            </div>
          ) : null}

          <fieldset className="space-y-1.5">
            <legend className="text-[11px] font-medium text-zinc-500">
              选择模式
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ref-mode"
                checked={draft.draftMode === "auto"}
                onChange={() => setDraft(switchDraftToAuto(draft))}
              />
              <span>自动选择</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ref-mode"
                checked={draft.draftMode === "manual"}
                onChange={() => {
                  if (!capability || limit == null) return;
                  setDraft(
                    switchDraftToManual({
                      draft,
                      autoSelectedIds:
                        autoResolved?.selected.map((c) => c.assetId) ?? [],
                      eligibleCount: view.eligibleCount,
                      limit,
                    }),
                  );
                }}
              />
              <span>手动选择</span>
            </label>
            {draft.draftMode === "auto" &&
            autoResolved &&
            !autoResolved.requiresManualSelection ? (
              <p className="text-[11px] text-zinc-500">
                已自动选择全部 {autoResolved.selected.length}{" "}
                项合法参考素材。
              </p>
            ) : null}
            {draft.draftMode === "auto" &&
            autoResolved?.requiresManualSelection ? (
              <button
                type="button"
                className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                onClick={() => {
                  if (!capability || limit == null) return;
                  setDraft(
                    switchDraftToManual({
                      draft,
                      autoSelectedIds: [],
                      eligibleCount: view.eligibleCount,
                      limit,
                    }),
                  );
                }}
              >
                切换为手动选择
              </button>
            ) : null}
          </fieldset>

          <section className="rounded-xl border border-zinc-100 p-2">
            <div className="text-[11px] font-medium text-zinc-500">首帧</div>
            {view.firstFrame ? (
              <div className="mt-2 flex gap-2">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                  {view.firstFrame.thumbnailUrl || view.firstFrame.url ? (
                    <AssetThumb
                      src={
                        view.firstFrame.thumbnailUrl ||
                        view.firstFrame.url ||
                        ""
                      }
                      alt={view.firstFrame.fileName || "首帧"}
                    />
                  ) : (
                    <ImageIcon className="m-auto mt-4 h-5 w-5 text-zinc-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-zinc-800">
                    {view.firstFrame.fileName || view.firstFrame.label}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    来源：{view.firstFrame.sourceNodeTitle}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {view.firstFrame.eligible
                      ? "有效"
                      : view.firstFrame.disabledReason}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    首帧不占普通参考素材名额
                    {capability
                      ? `（上限 ${capability.maxFirstFrames}）`
                      : ""}
                    ；画面比例将由首帧决定
                  </div>
                  {onJumpToNode ? (
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-sky-700 underline"
                      onClick={() =>
                        onJumpToNode(view.firstFrame!.sourceNodeId)
                      }
                    >
                      跳转到来源节点
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-400">未连接首帧</p>
            )}
            {view.firstFrameErrors.length > 0 ? (
              <p className="mt-1 text-[11px] text-rose-600">
                {view.firstFrameErrors.map((e) => e.message).join("；")}
              </p>
            ) : null}
          </section>

          {draft.draftMode === "manual" && invalidDraftIds.length > 0 ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-2">
              <div className="text-[11px] font-medium text-rose-800">
                失效选择
              </div>
              <ul className="mt-1 space-y-1">
                {invalidDraftIds.map((id) => (
                  <li key={id} className="truncate text-[11px] text-rose-700">
                    {id}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 rounded-lg border border-rose-300 px-2 py-1 text-[11px] text-rose-800"
                onClick={() =>
                  setDraft(
                    removeInvalidDraftIds({
                      draft,
                      invalidIds: invalidDraftIds,
                    }),
                  )
                }
              >
                移除失效项
              </button>
            </section>
          ) : null}

          {draft.draftMode === "manual" ? (
            <section>
              <div className="text-[11px] font-medium text-zinc-500">
                发送顺序（最终顺序来源）
              </div>
              {draft.draftSelectedIds.length === 0 ? (
                <p className="mt-1 text-[11px] text-zinc-400">
                  手动选择为空（不会自动补齐）
                </p>
              ) : (
                <ol className="mt-1 space-y-1">
                  {draft.draftSelectedIds.map((id, index) => {
                    const c = candidates.find((x) => x.assetId === id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5"
                      >
                        <span className="w-12 shrink-0 text-[10px] text-zinc-500">
                          第 {index + 1} 项
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {c?.label || c?.fileName || id}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                          aria-label={`将 ${c?.label || id} 上移`}
                          disabled={!canMoveDraftSelection(draft, id, "up")}
                          onClick={() =>
                            setDraft(
                              moveDraftSelection({
                                draft,
                                assetId: id,
                                direction: "up",
                              }),
                            )
                          }
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                          aria-label={`将 ${c?.label || id} 下移`}
                          disabled={!canMoveDraftSelection(draft, id, "down")}
                          onClick={() =>
                            setDraft(
                              moveDraftSelection({
                                draft,
                                assetId: id,
                                direction: "down",
                              }),
                            )
                          }
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="text-[11px] font-medium text-zinc-500">
              候选素材（按来源浏览）
            </div>
            {view.groups.map((group) => (
              <div key={group.key}>
                <div className="mb-1 text-[11px] text-zinc-400">
                  {group.title}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((item) => {
                    const checked =
                      draft.draftMode === "auto"
                        ? Boolean(
                            autoResolved?.selected.some(
                              (s) => s.assetId === item.assetId,
                            ),
                          )
                        : draft.draftSelectedIds.includes(item.assetId);
                    const sendIndex =
                      draft.draftMode === "manual"
                        ? draft.draftSelectedIds.indexOf(item.assetId)
                        : (autoResolved?.selected.findIndex(
                            (s) => s.assetId === item.assetId,
                          ) ?? -1);
                    const checkboxDisabled =
                      !item.eligible ||
                      draft.draftMode === "auto" ||
                      (!checked && atLimit);
                    return (
                      <li
                        key={item.assetId}
                        className={`flex gap-2 rounded-lg border px-2 py-1.5 ${
                          checked
                            ? "border-sky-300 bg-sky-50/50"
                            : "border-zinc-100"
                        } ${!item.eligible ? "opacity-70" : ""}`}
                      >
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100">
                          {item.mediaKind === "video" ? (
                            <Clapperboard className="m-auto mt-3.5 h-5 w-5 text-zinc-500" />
                          ) : item.thumbnailUrl || item.url ? (
                            <AssetThumb
                              src={item.thumbnailUrl || item.url || ""}
                              alt={item.fileName || item.label}
                            />
                          ) : (
                            <ImageIcon className="m-auto mt-3.5 h-5 w-5 text-zinc-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              disabled={checkboxDisabled}
                              aria-label={`选择参考素材 ${item.label}`}
                              onChange={() => {
                                if (!capability || limit == null) return;
                                setDraft(
                                  toggleDraftSelection({
                                    draft,
                                    assetId: item.assetId,
                                    eligible: item.eligible,
                                    limit,
                                  }),
                                );
                              }}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-zinc-800">
                                {item.fileName || item.label}
                              </span>
                              <span className="block text-[10px] text-zinc-500">
                                {item.label} · {item.sourceNodeTitle}
                                {item.characterVariantName
                                  ? ` · ${item.characterVariantName}`
                                  : ""}
                                {item.sceneViewpoint
                                  ? ` · ${item.sceneViewpoint}`
                                  : ""}
                                {item.imageReferenceType
                                  ? ` · ${item.imageReferenceType}`
                                  : ""}
                              </span>
                              <span className="block text-[10px] text-zinc-400">
                                {item.mimeType || "未知类型"} ·{" "}
                                {item.eligible
                                  ? "可用"
                                  : `不可用：${item.disabledReason || "未知原因"}`}
                                {sendIndex >= 0
                                  ? ` · 发送序号 ${sendIndex + 1}`
                                  : ""}
                              </span>
                            </span>
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {view.groups.length === 0 ? (
              <p className="text-[11px] text-zinc-400">暂无候选参考素材</p>
            ) : null}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-50"
            onClick={handleCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={!canSave}
            onClick={handleSave}
          >
            保存选择
          </button>
        </div>
      </div>
    </div>
  );
}
