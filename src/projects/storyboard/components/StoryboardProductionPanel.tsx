"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmStoryboard,
  fetchEpisodeProduction,
  fetchVideoGenerationPublicConfig,
  generateEpisodeVideos,
  insertBlankStoryboardShot,
  deleteStoryboardShot,
  StoryboardConfirmIncompleteError,
} from "@/projects/storyboard/api-client";
import { ShotSceneRequiredDialog } from "@/projects/storyboard/components/ShotSceneRequiredDialog";
import { StoryboardShotAccordion } from "@/projects/storyboard/components/StoryboardShotAccordion";
import { StoryboardPlaybackBar } from "@/projects/storyboard/components/StoryboardPlaybackBar";
import { ShotVideoPreview } from "@/projects/storyboard/components/ShotVideoPreview";
import { StoryboardEmptyTimeline } from "@/projects/storyboard/components/StoryboardEmptyTimeline";
import { StoryboardEpisodeStagePanel } from "@/projects/storyboard/components/StoryboardEpisodeStagePanel";
import { StoryboardWorkspaceShell } from "@/projects/storyboard/components/StoryboardWorkspaceShell";
import { ShotAssetCard } from "@/projects/storyboard/components/ShotAssetCard";
import { ShotVideoOutputParams } from "@/projects/storyboard/components/ShotVideoOutputParams";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import {
  VideoGenerationConfirmationDialog,
  type VideoGenerationConfirmPayload,
} from "@/projects/storyboard/components/VideoGenerationConfirmationDialog";
import type { EpisodeProduction } from "@/projects/storyboard/types";
import {
  getShotVideoPrompt,
  isShotConfirmReady,
  listFlatShots,
} from "@/projects/storyboard/shot-completeness";
import { listShotVideoBlockers } from "@/projects/storyboard/shot-video-precheck";
import {
  estimateStoryboardVideoCredits,
  STORYBOARD_VIDEO_ASPECT_RATIO,
  STORYBOARD_VIDEO_RESOLUTION,
} from "@/projects/storyboard/storyboard-video-constants";
import {
  defaultStoryboardVideoDefaults,
  sumStoryboardDurationSeconds,
} from "@/projects/storyboard/storyboard-video-params";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import { safeRandomUUID } from "@/lib/safe-random-id";

type Props = {
  projectId: string;
  production: EpisodeProduction;
  assets: PickerAsset[];
  onProductionChange: (production: EpisodeProduction) => void;
  onAssetsRefresh?: () => Promise<void> | void;
  onNote: (note: string) => void;
  onScriptDraftChange?: (text: string | null) => void;
  canGenerateVideo?: boolean;
  /** 项目级视频默认；单镜头可覆盖 */
  videoDefaults?: import("@/projects/storyboard/storyboard-video-params").StoryboardVideoDefaults | null;
  onVideoDefaultsChange?: (
    next: import("@/projects/storyboard/storyboard-video-params").StoryboardVideoDefaults,
  ) => void | Promise<void>;
  videoDefaultsSaving?: boolean;
  /** 本集提示词生成展示状态 */
  promptGenStatus?: import("@/projects/storyboard/prompt-generation-manager").EpisodePromptGenUiStatus;
  /** @deprecated 失败文案已改走消息通知；保留字段以免调用方报错 */
  promptGenError?: string;
  /** 本集下游阶段（资产 / 分镜提示词） */
  episodeDownstream?: import("@/projects/storyboard/episode-downstream-state").EpisodeDownstreamStatus | null;
  episodeNumber?: number;
  episodeTitle?: string | null;
  extractBusy?: boolean;
  extractingAssets?: boolean;
  onExtractEpisode?: () => void;
  onRegenerateStoryboard?: () => void;
  regenerateBusy?: boolean;
  assetsHref?: string;
  designHref?: string;
  pageSaveNote?: string;
  /** Q80–Q84 invalid reference scan for current episode (and project when repaired). */
  invalidRefScan?: import("@/projects/storyboard/invalid-refs/types").InvalidRefScanResult | null;
  onOpenInvalidRefsRepair?: (shotId?: string | null) => void;
};

export function StoryboardProductionPanel({
  projectId,
  production,
  assets,
  onProductionChange,
  onAssetsRefresh,
  onNote,
  onScriptDraftChange,
  canGenerateVideo = true,
  videoDefaults = null,
  onVideoDefaultsChange,
  videoDefaultsSaving = false,
  promptGenStatus = "idle",
  promptGenError: _promptGenError,
  episodeDownstream = null,
  episodeNumber = 1,
  episodeTitle = null,
  extractBusy = false,
  extractingAssets = false,
  onExtractEpisode,
  onRegenerateStoryboard,
  regenerateBusy = false,
  assetsHref = "",
  designHref,
  pageSaveNote,
  invalidRefScan = null,
  onOpenInvalidRefsRepair,
}: Props) {
  const batchKeyRef = useRef<string>(safeRandomUUID());
  const [batchBusy, setBatchBusy] = useState(false);
  const [panelNote, setPanelNote] = useState("");
  const [insertShotBusyAfterId, setInsertShotBusyAfterId] = useState<
    string | null
  >(null);
  const [deleteShotBusyId, setDeleteShotBusyId] = useState<string | null>(null);
  const [seededBoardId, setSeededBoardId] = useState<string | null>(null);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [focusShotId, setFocusShotId] = useState<string | null>(null);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [sceneBlockDialogOpen, setSceneBlockDialogOpen] = useState(false);
  const [sceneBlockers, setSceneBlockers] = useState<
    Array<{ shotId: string; shotLabel: string; message: string }>
  >([]);
  const [includeSucceeded, setIncludeSucceeded] = useState(false);
  const [scenePickerTokens, setScenePickerTokens] = useState<
    Record<string, number>
  >({});
  const [videoConfig, setVideoConfig] = useState<{
    providerId: string;
    allowPaidGeneration: boolean;
    t2vModelId: string;
    r2vModelId: string;
    usesSd2RealPersonCertification?: boolean;
  } | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const storyboard = production.activeStoryboard;
  const displayScript =
    production.confirmedScriptText ?? production.workingScriptText;
  const flat = useMemo(
    () => (storyboard ? listFlatShots(storyboard.scenes) : []),
    [storyboard],
  );
  const playbackShots = useMemo(() => flat.map((row) => row.shot), [flat]);
  const activeRow = useMemo(
    () => flat.find((row) => row.shot.id === activeShotId) ?? flat[0] ?? null,
    [activeShotId, flat],
  );
  const shotCount = flat.length;
  const totalDuration = useMemo(
    () => sumStoryboardDurationSeconds(flat.map((row) => row.shot)),
    [flat],
  );
  const confirmed = production.status === "storyboard_done";

  const validSceneIds = useMemo(
    () => new Set(assets.filter((a) => a.kind === "scene").map((a) => a.id)),
    [assets],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await fetchVideoGenerationPublicConfig();
        if (!cancelled) setVideoConfig(config);
      } catch {
        if (!cancelled) setVideoConfig(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * If the browser loses the long-running generate request (refresh / HMR / tab
   * remount), status can stay `storyboard_generating` on the client. Poll until
   * the server leaves that status so the UI recovers when the LLM finishes.
   */
  useEffect(() => {
    if (production.status !== "storyboard_generating") return;
    let cancelled = false;
    let inFlight = false;
    const episodeId = production.episodeId;
    let lastRevision = production.revision;
    let lastUpdatedAt = production.updatedAt;
    let lastStatus: EpisodeProduction["status"] = production.status;

    const sync = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const latest = await fetchEpisodeProduction(projectId, episodeId);
        if (cancelled) return;
        const changed =
          latest.revision !== lastRevision ||
          latest.status !== lastStatus ||
          latest.updatedAt !== lastUpdatedAt;
        if (changed) {
          lastRevision = latest.revision;
          lastUpdatedAt = latest.updatedAt;
          lastStatus = latest.status;
          onProductionChange(latest);
        }
        if (latest.status !== "storyboard_generating") {
          // Progress / soft-warning / failure copy is delivered via in-app
          // notifications; avoid duplicating long banners in the workspace.
          if (
            latest.status === "storyboard_incomplete" ||
            latest.status === "storyboard_done"
          ) {
            setPanelNote("");
          } else if (latest.status === "generation_failed") {
            setPanelNote("");
          }
        }
      } catch {
        // Keep polling; transient network blips should not clear the lock UI.
      } finally {
        inFlight = false;
      }
    };

    void sync();
    const timer = window.setInterval(() => void sync(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Narrow deps: restart only when lock status / episode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid poll restart storms
  }, [production.status, production.episodeId, projectId]);

  if (storyboard && seededBoardId !== storyboard.id) {
    setSeededBoardId(storyboard.id);
    setActiveShotId(flat[0]?.shot.id ?? null);
    setFocusShotId(null);
  }

  useEffect(() => {
    if (!storyboard || flat.length === 0) return;
    if (activeShotId && flat.some((row) => row.shot.id === activeShotId)) {
      return;
    }
    setActiveShotId(flat[0]!.shot.id);
    setFocusShotId(null);
  }, [storyboard, flat, activeShotId]);

  const episodeVideoEnabled = useMemo(() => {
    if (!storyboard || !canGenerateVideo) {
      return false;
    }
    if (flat.length === 0) return false;
    if (!flat.every((r) => getShotVideoPrompt(r.shot).length > 0)) return false;
    return true;
  }, [canGenerateVideo, flat, storyboard]);

  const focusIncompleteShot = useCallback(
    (shotId: string, message: string) => {
      setFocusShotId(shotId);
      setActiveShotId(shotId);
      setPanelNote(message);
      onNote(message);
      requestAnimationFrame(() => {
        const el = cardRefs.current.get(shotId);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [onNote],
  );

  const focusShotScene = useCallback((shotId: string) => {
    setFocusShotId(shotId);
    setActiveShotId(shotId);
    setSceneBlockDialogOpen(false);
    setVideoDialogOpen(false);
    setBatchBusy(false);
    setScenePickerTokens((prev) => ({
      ...prev,
      [shotId]: (prev[shotId] ?? 0) + 1,
    }));
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(shotId);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleInsertShotAfter = useCallback(
    async (shotId: string) => {
      if (insertShotBusyAfterId) return;
      setInsertShotBusyAfterId(shotId);
      setPanelNote("");
      try {
        const result = await insertBlankStoryboardShot(
          projectId,
          production.episodeId,
          shotId,
        );
        onProductionChange(result.production);
        setActiveShotId(result.shot.id);
        setFocusShotId(null);
        setPanelNote(
          `已创建空白分镜 ${String(result.shot.shotNumber).padStart(2, "0")}`,
        );
      } catch (error) {
        setPanelNote(error instanceof Error ? error.message : "新建分镜失败");
      } finally {
        setInsertShotBusyAfterId(null);
      }
    },
    [insertShotBusyAfterId, onProductionChange, production.episodeId, projectId],
  );

  const handleDeleteShot = useCallback(
    async (shotId: string) => {
      if (deleteShotBusyId) return;
      const index = flat.findIndex((row) => row.shot.id === shotId);
      const target = flat[index]?.shot;
      if (!target) return;
      setDeleteShotBusyId(shotId);
      setPanelNote("");
      try {
        const updated = await deleteStoryboardShot(
          projectId,
          production.episodeId,
          shotId,
          { revision: target.revision },
        );
        onProductionChange(updated);
        const nextFlat = updated.activeStoryboard
          ? listFlatShots(updated.activeStoryboard.scenes)
          : [];
        const preferred =
          nextFlat[index]?.shot.id ?? nextFlat[index - 1]?.shot.id ?? null;
        setActiveShotId(preferred);
        setFocusShotId(null);
        setPanelNote("已删除分镜");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "删除分镜失败";
        setPanelNote(message);
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setDeleteShotBusyId(null);
      }
    },
    [
      deleteShotBusyId,
      flat,
      onProductionChange,
      production.episodeId,
      projectId,
    ],
  );

  const pendingVideoCount = useMemo(() => {
    return flat.filter((row) => {
      const shot = row.shot;
      if (shot.videoContentStale) return true;
      if (!shot.lastGenerationId) return true;
      return false;
    }).length;
  }, [flat]);

  const succeededVideoCount = shotCount - pendingVideoCount;

  const confirmPayload: VideoGenerationConfirmPayload | null = useMemo(() => {
    if (!videoDialogOpen) return null;
    const isMock = videoConfig?.providerId === "mock";
    const isPaid = videoConfig?.providerId === "aliyun-wan27";
    const pending = includeSucceeded ? shotCount : Math.max(pendingVideoCount, 1);
    const pendingRows = includeSucceeded
      ? flat
      : flat.filter(
          (row) => row.shot.videoContentStale || !row.shot.lastGenerationId,
        );
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const missingVoiceNames: string[] = [];
    const skippedRealPersonNames: string[] = [];
    const seen = new Set<string>();
    for (const row of flat) {
      for (const id of row.shot.characterAssetIds) {
        if (seen.has(id)) continue;
        const asset = assetById.get(id);
        if (!asset || asset.kind !== "character") continue;
        seen.add(id);
        if (asset.voiceBound !== true) {
          missingVoiceNames.push(asset.name);
        }
        if (asset.videoRefSafetyStatus === "likely_real_person") {
          skippedRealPersonNames.push(asset.name);
        }
      }
    }
    let creditEstimate: number | null = 0;
    const estimateRows =
      pendingRows.length > 0 ? pendingRows : flat.slice(0, pending);
    for (const row of estimateRows) {
      const points = estimateStoryboardVideoCredits(
        row.shot.durationSeconds,
        STORYBOARD_VIDEO_RESOLUTION,
      );
      if (points == null) {
        creditEstimate = null;
        break;
      }
      creditEstimate += points;
    }
    if (estimateRows.length === 0) {
      creditEstimate = estimateStoryboardVideoCredits(
        totalDuration,
        STORYBOARD_VIDEO_RESOLUTION,
      );
    }
    return {
      mode: "episode",
      episodeLabel: `第 ${production.episodeNumber} 集`,
      shotCount,
      pendingCount: includeSucceeded ? shotCount : pendingVideoCount,
      succeededCount: succeededVideoCount,
      totalDurationSeconds: totalDuration,
      aspectRatio: STORYBOARD_VIDEO_ASPECT_RATIO,
      resolution: STORYBOARD_VIDEO_RESOLUTION,
      modelLabel:
        videoConfig?.r2vModelId ||
        videoConfig?.t2vModelId ||
        videoConfig?.providerId ||
        "默认",
      creditEstimate,
      isPaidProvider: Boolean(isPaid),
      isMockProvider: Boolean(isMock),
      allowIncludeSucceeded: true,
      charactersMissingVoice: missingVoiceNames,
      charactersSkippedForRealPerson: skippedRealPersonNames,
      usesSd2RealPersonCertification: Boolean(
        videoConfig?.usesSd2RealPersonCertification,
      ),
    };
  }, [
    assets,
    flat,
    includeSucceeded,
    pendingVideoCount,
    production.episodeNumber,
    shotCount,
    succeededVideoCount,
    totalDuration,
    videoConfig,
    videoDialogOpen,
  ]);

  /** 预检在 busy / batchId / 付费确认之前 */
  const handleRequestBatchGenerate = useCallback(() => {
    setPanelNote("");
    const blockers = listShotVideoBlockers(
      flat.map((r) => r.shot),
      validSceneIds,
    );
    const sceneBlocks = blockers.filter(
      (b) =>
        b.code === "SHOT_SCENE_REQUIRED" || b.code === "SHOT_SCENE_INVALID",
    );
    if (sceneBlocks.length > 0) {
      setBatchBusy(false);
      setVideoDialogOpen(false);
      setSceneBlockers(
        sceneBlocks.map((b) => ({
          shotId: b.shotId,
          shotLabel: `镜头 ${String(b.shotNumber).padStart(2, "0")}`,
          message:
            b.code === "SHOT_SCENE_INVALID"
              ? "场景需求尚未处理或无效"
              : "未添加场景",
        })),
      );
      setSceneBlockDialogOpen(true);
      return;
    }
    if (blockers.length > 0) {
      const first = blockers[0]!;
      focusIncompleteShot(first.shotId, first.message);
      setBatchBusy(false);
      setVideoDialogOpen(false);
      return;
    }
    setSceneBlockDialogOpen(false);
    setIncludeSucceeded(false);
    setVideoDialogOpen(true);
  }, [flat, focusIncompleteShot, validSceneIds]);

  const handleBatchGenerate = useCallback(async () => {
    if (!storyboard) return;

    const blockers = listShotVideoBlockers(
      flat.map((r) => r.shot),
      validSceneIds,
    );
    if (blockers.length > 0) {
      setVideoDialogOpen(false);
      setBatchBusy(false);
      const sceneBlocks = blockers.filter(
        (b) =>
          b.code === "SHOT_SCENE_REQUIRED" || b.code === "SHOT_SCENE_INVALID",
      );
      if (sceneBlocks.length > 0) {
        setSceneBlockers(
          sceneBlocks.map((b) => ({
            shotId: b.shotId,
            shotLabel: `镜头 ${String(b.shotNumber).padStart(2, "0")}`,
            message:
              b.code === "SHOT_SCENE_INVALID"
                ? "场景需求尚未处理或无效"
                : "未添加场景",
          })),
        );
        setSceneBlockDialogOpen(true);
      } else {
        focusIncompleteShot(blockers[0]!.shotId, blockers[0]!.message);
      }
      return;
    }

    setBatchBusy(true);
    setPanelNote("");
    try {
      let currentStoryboard = storyboard;
      if (production.status !== "storyboard_done" || !storyboard.confirmedAt) {
        const firstLocal = flat.find((row) => !isShotConfirmReady(row.shot));
        if (firstLocal) {
          const count = flat.filter(
            (row) => !isShotConfirmReady(row.shot),
          ).length;
          setVideoDialogOpen(false);
          focusIncompleteShot(
            firstLocal.shot.id,
            `当前还有 ${count} 个镜头需要补充提示词或素材。`,
          );
          return;
        }
        try {
          const confirmedProduction = await confirmStoryboard(
            projectId,
            production.episodeId,
          );
          onProductionChange(confirmedProduction);
          if (!confirmedProduction.activeStoryboard) {
            throw new Error("确认分镜后缺少分镜数据");
          }
          currentStoryboard = confirmedProduction.activeStoryboard;
        } catch (error) {
          if (error instanceof StoryboardConfirmIncompleteError) {
            setVideoDialogOpen(false);
            const shotId =
              error.firstIncompleteShotId ??
              flat.find((row) => !isShotConfirmReady(row.shot))?.shot.id;
            if (shotId) {
              focusIncompleteShot(shotId, error.message);
            } else {
              setPanelNote(error.message);
              onNote(error.message);
            }
            return;
          }
          throw error;
        }
      }

      const result = await generateEpisodeVideos(
        projectId,
        production.episodeId,
        {
          storyboardRevision: currentStoryboard.revision,
          idempotencyKey: batchKeyRef.current,
          includeSucceeded,
          confirmPaidGeneration: videoConfig?.providerId === "aliyun-wan27",
        },
      );
      if (result.production) onProductionChange(result.production);
      setPanelNote(
        `已确认本集分镜，并提交 ${result.shots.length} 个镜头生成任务${
          result.skippedCount ? `，跳过 ${result.skippedCount} 个已成功镜头` : ""
        }。`,
      );
      onNote("本集视频生成已提交。");
      setVideoDialogOpen(false);
    } catch (error) {
      const err = error as Error & {
        firstBlockedShotId?: string;
        code?: string;
      };
      const message = err.message || "批量生成失败";
      setVideoDialogOpen(false);
      if (
        err.code === "SHOT_SCENE_REQUIRED" ||
        err.code === "SHOT_SCENE_INVALID" ||
        err.code === "SHOT_ASSET_INCOMPLETE"
      ) {
        if (err.firstBlockedShotId) {
          focusShotScene(err.firstBlockedShotId);
        }
        setPanelNote(message);
        onNote(message);
      } else if (err.firstBlockedShotId) {
        focusIncompleteShot(err.firstBlockedShotId, message);
      } else {
        setPanelNote(message);
        onNote(message);
      }
    } finally {
      batchKeyRef.current = safeRandomUUID();
      setBatchBusy(false);
    }
  }, [
    flat,
    focusIncompleteShot,
    focusShotScene,
    includeSucceeded,
    onNote,
    onProductionChange,
    production.episodeId,
    production.status,
    projectId,
    storyboard,
    validSceneIds,
    videoConfig,
  ]);

  const isGenerating =
    promptGenStatus === "generating" ||
    promptGenStatus === "queued" ||
    production.status === "storyboard_generating";
  useGenerationBusy(
    batchBusy,
    `storyboard-video-batch-${projectId}-${production.episodeId}`,
    "整集视频生成提交",
    {
      projectId,
      episodeId: production.episodeId,
      kind: "storyboard-video",
      taskStatus: "generating",
    },
  );

  const episodeVideoDisabledReason = !storyboard
    ? "请等待分镜生成完成"
    : !canGenerateVideo
      ? "当前账号无视频生成权限"
      : flat.length === 0 ||
          !flat.every((r) => getShotVideoPrompt(r.shot).length > 0)
        ? "请先完善全部镜头提示词"
        : "暂不可生成";

  const projectAssetsPanel = (
    <>
      <div className="sbw-shot-section__head">
        <h4>项目素材</h4>
      </div>
      {(["character", "scene", "prop"] as const).map((kind) => {
        const label =
          kind === "character" ? "人物" : kind === "scene" ? "场景" : "道具";
        const group = assets.filter((asset) => asset.kind === kind);
        return (
          <div key={kind} className="sbw-asset-group" data-asset-kind={kind}>
            <div className="sbw-asset-group__head">
              <strong>{label}</strong>
            </div>
            {group.length > 0 ? (
              <div
                className={`sbw-asset-gallery${
                  kind === "scene" ? " is-scene" : ""
                }`}
              >
                {group.map((asset) => (
                  <ShotAssetCard key={asset.id} asset={asset} disabled />
                ))}
              </div>
            ) : (
              <p className="sbw-hint">暂无{label}</p>
            )}
          </div>
        );
      })}
    </>
  );

  const emptyVideoAspect =
    videoDefaults?.aspectRatio ??
    (STORYBOARD_VIDEO_ASPECT_RATIO === "9:16" ? "9:16" : "16:9");

  const preStoryboardPrompt = (
    <>
      {episodeDownstream ? (
        <StoryboardEpisodeStagePanel
          episodeNumber={episodeNumber}
          episodeTitle={episodeTitle}
          downstream={episodeDownstream}
          extracting={extractingAssets}
          extractBusy={extractBusy}
          onExtractEpisode={onExtractEpisode}
          onRegenerateStoryboard={onRegenerateStoryboard}
          regenerateBusy={regenerateBusy}
        />
      ) : null}
      <h4>{isGenerating ? "分镜提示词生成中" : "本集剧本"}</h4>
      {isGenerating ? (
        <div
          className="sbw-empty"
          data-testid="storyboard-workspace-generating"
          aria-live="polite"
        >
          分镜提示词生成中，进度请查看右上角消息通知。
        </div>
      ) : displayScript.trim() ? (
        <pre className="sbw-pre" data-testid="storyboard-script-preview">
          {displayScript}
        </pre>
      ) : (
        <div className="sbw-empty">暂无剧本内容，请先在剧本创作页上传并确认。</div>
      )}
      <div className="sbw-actions sbw-actions--wrap sbw-actions--prompt">
        <button
          type="button"
          className="sbw-btn sbw-btn-muted"
          data-testid="generate-shot-storyboard-video"
          disabled
          title="分镜生成完成后，选中镜头即可生成视频"
        >
          生成本分镜视频
        </button>
      </div>
    </>
  );

  const emptyTimeline = <StoryboardEmptyTimeline />;

  return (
    <div className="sbw-panel sbw-panel--storyboard-workspace">
      <div className="sbw-panel__head sbw-panel__head--row">
        <div>
          <p className="sbw-hint" style={{ margin: 0 }}>
            第 {production.episodeNumber} 集
            {shotCount > 0 ? ` · ${shotCount} 个分镜` : ""}
            {confirmed ? " · 分镜已确认" : ""}
          </p>
          {pageSaveNote ? (
            <p className="sbw-panel__head-note">{pageSaveNote}</p>
          ) : null}
        </div>
        <div className="sbw-panel__head-actions">
          <ShotVideoOutputParams
            mode="defaults"
            value={videoDefaults ?? defaultStoryboardVideoDefaults()}
            disabled={videoDefaultsSaving}
            onChange={(next) => {
              void onVideoDefaultsChange?.(next);
            }}
          />
        </div>
      </div>

      <div className="sbw-panel__body">
        {production.storyboardStale || production.promptRefresh ? (
          <div className="sbw-banner" data-testid="script-changed-reminder">
            {production.promptRefresh?.notice ??
              "提示词已根据剧本更新，现有制作结果保留"}
            {production.promptRefresh?.updatedAt
              ? `（版本 ${production.promptRefresh.scriptRevision} · ${production.promptRefresh.updatedAt}）`
              : ""}
            {production.promptRefresh?.reviewShotIds?.length
              ? `；${production.promptRefresh.reviewShotIds.length} 个镜头需复核手动提示词。`
              : ""}
          </div>
        ) : null}

        {invalidRefScan && invalidRefScan.issueCount > 0 ? (
          <div className="sbw-banner" data-testid="invalid-refs-banner">
            发现 {invalidRefScan.issueCount} 项失效资产/媒体引用
            {invalidRefScan.pendingManualSelectionCount > 0
              ? `（待逐镜选择 ${invalidRefScan.pendingManualSelectionCount}）`
              : ""}
            。
            {onOpenInvalidRefsRepair ? (
              <button
                type="button"
                className="sbw-link"
                data-testid="invalid-refs-open-repair"
                onClick={() => onOpenInvalidRefsRepair(null)}
              >
                修复
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="sbw-shot-list sbw-shot-list--workspace">
          {activeRow && storyboard ? (
            <StoryboardShotAccordion
              key={activeRow.shot.id}
              projectId={projectId}
              episodeId={production.episodeId}
              storyboardRevision={storyboard.revision}
              episodeConfirmed={confirmed}
              canGenerateVideo={canGenerateVideo}
              shot={activeRow.shot}
              expanded
              workspaceMode
              workspaceTimeline={
                <StoryboardPlaybackBar
                  projectId={projectId}
                  episodeId={production.episodeId}
                  shots={playbackShots}
                  workspaceMode
                  selectedShotId={activeRow.shot.id}
                  onSelectShot={(shotId) => {
                    setActiveShotId(shotId);
                    setFocusShotId(null);
                  }}
                  onInsertShotAfter={handleInsertShotAfter}
                  insertShotBusyAfterId={insertShotBusyAfterId}
                  onDeleteShot={handleDeleteShot}
                  deleteShotBusyId={deleteShotBusyId}
                  initialAspectRatio={
                    videoDefaults?.aspectRatio ??
                    (STORYBOARD_VIDEO_ASPECT_RATIO === "9:16" ? "9:16" : "16:9")
                  }
                />
              }
              onToggle={() => undefined}
              assets={assets}
              invalidRefIssues={
                invalidRefScan?.episodes
                  .flatMap((ep) => ep.issues)
                  .filter((issue) => issue.shotId === activeRow.shot.id) ?? []
              }
              onRepairInvalidRefs={
                onOpenInvalidRefsRepair
                  ? (shotId) => onOpenInvalidRefsRepair(shotId)
                  : undefined
              }
              onProductionChange={onProductionChange}
              onAssetsRefresh={onAssetsRefresh}
              highlightUnresolved={focusShotId === activeRow.shot.id}
              openScenePickerToken={scenePickerTokens[activeRow.shot.id] ?? 0}
              videoConfig={videoConfig}
              videoDefaults={videoDefaults}
              cardRef={(el) => {
                if (el) cardRefs.current.set(activeRow.shot.id, el);
                else cardRefs.current.delete(activeRow.shot.id);
              }}
            />
          ) : storyboard && flat.length > 0 ? (
            <StoryboardWorkspaceShell
              assets={projectAssetsPanel}
              prompt={
                <>
                  <h4>请选择分镜</h4>
                  <div className="sbw-empty">
                    请从下方时间轴选择一个分镜继续编辑。
                  </div>
                </>
              }
              video={
                <ShotVideoPreview
                  workspaceMode
                  aspectRatio={emptyVideoAspect}
                  status="pending"
                  projectId={projectId}
                  historyVideos={[]}
                  successGenerations={[]}
                />
              }
              timeline={
                <StoryboardPlaybackBar
                  projectId={projectId}
                  episodeId={production.episodeId}
                  shots={playbackShots}
                  workspaceMode
                  selectedShotId={null}
                  onSelectShot={(shotId) => {
                    setActiveShotId(shotId);
                    setFocusShotId(null);
                  }}
                  onInsertShotAfter={handleInsertShotAfter}
                  insertShotBusyAfterId={insertShotBusyAfterId}
                  onDeleteShot={handleDeleteShot}
                  deleteShotBusyId={deleteShotBusyId}
                  initialAspectRatio={emptyVideoAspect}
                />
              }
            />
          ) : (
            <StoryboardWorkspaceShell
              assets={projectAssetsPanel}
              prompt={preStoryboardPrompt}
              video={
                <ShotVideoPreview
                  workspaceMode
                  aspectRatio={emptyVideoAspect}
                  status={isGenerating ? "processing" : "pending"}
                  progress={isGenerating ? 12 : null}
                  projectId={projectId}
                  historyVideos={[]}
                  successGenerations={[]}
                />
              }
              timeline={emptyTimeline}
            />
          )}
        </div>

        {panelNote ? <p className="sbw-note">{panelNote}</p> : null}
      </div>

      <ShotSceneRequiredDialog
        open={sceneBlockDialogOpen}
        shotLabel={sceneBlockers[0]?.shotLabel ?? ""}
        mode="episode"
        blockers={sceneBlockers.map((b) => ({
          shotLabel: b.shotLabel,
          message: b.message,
        }))}
        onCancel={() => {
          setSceneBlockDialogOpen(false);
          setBatchBusy(false);
        }}
        onGoFix={() => {
          const first = sceneBlockers[0];
          if (first) focusShotScene(first.shotId);
          else {
            setSceneBlockDialogOpen(false);
            setBatchBusy(false);
          }
        }}
      />

      <VideoGenerationConfirmationDialog
        open={videoDialogOpen}
        payload={confirmPayload}
        includeSucceeded={includeSucceeded}
        onIncludeSucceededChange={setIncludeSucceeded}
        confirming={batchBusy}
        onCancel={() => {
          if (batchBusy) return;
          setVideoDialogOpen(false);
        }}
        onConfirm={() => void handleBatchGenerate()}
      />
    </div>
  );
}
