"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  confirmScript,
  confirmStoryboard,
  fetchEpisodeProduction,
  fetchVideoGenerationPublicConfig,
  generateEpisodeVideos,
  generateStoryboard,
  patchWorkingScript,
  ScriptInvalidateRequiredError,
  StoryboardConfirmIncompleteError,
  StoryboardGenerateInProgressError,
} from "@/projects/storyboard/api-client";
import { EpisodeVideoGenerationButton } from "@/projects/storyboard/components/EpisodeVideoGenerationButton";
import { ShotSceneRequiredDialog } from "@/projects/storyboard/components/ShotSceneRequiredDialog";
import { StoryboardShotAccordion } from "@/projects/storyboard/components/StoryboardShotAccordion";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import {
  VideoGenerationConfirmationDialog,
  type VideoGenerationConfirmPayload,
} from "@/projects/storyboard/components/VideoGenerationConfirmationDialog";
import type { EpisodeProduction } from "@/projects/storyboard/types";
import {
  countIncompleteShots,
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
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";

type Props = {
  projectId: string;
  production: EpisodeProduction;
  assets: PickerAsset[];
  onProductionChange: (production: EpisodeProduction) => void;
  onNote: (note: string) => void;
  onScriptDraftChange?: (text: string | null) => void;
  canGenerateVideo?: boolean;
};

export function StoryboardProductionPanel({
  projectId,
  production,
  assets,
  onProductionChange,
  onNote,
  onScriptDraftChange,
  canGenerateVideo = true,
}: Props) {
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const batchKeyRef = useRef<string>(crypto.randomUUID());
  const [generating, setGenerating] = useState(false);
  const [confirmingScript, setConfirmingScript] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [scriptText, setScriptText] = useState(production.workingScriptText);
  const [showInvalidateDialog, setShowInvalidateDialog] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [panelNote, setPanelNote] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seededBoardId, setSeededBoardId] = useState<string | null>(null);
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
  const scriptDirty = scriptText !== production.workingScriptText;
  const scriptConfirmed = Boolean(production.confirmedScriptText?.trim());
  const flat = useMemo(
    () => (storyboard ? listFlatShots(storyboard.scenes) : []),
    [storyboard],
  );
  const shotCount = flat.length;
  const totalDuration = useMemo(
    () => flat.reduce((sum, row) => sum + row.shot.durationSeconds, 0),
    [flat],
  );
  const incompleteCount = useMemo(
    () => countIncompleteShots(flat.map((r) => r.shot)),
    [flat],
  );
  const confirmed = production.status === "storyboard_done";

  useEffect(() => {
    if (!scriptModalOpen) {
      setScriptText(production.workingScriptText);
    }
  }, [
    scriptModalOpen,
    production.episodeId,
    production.workingScriptRevision,
    production.workingScriptText,
  ]);

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
          setGenerating(false);
          if (
            latest.status === "storyboard_incomplete" ||
            latest.status === "storyboard_done"
          ) {
            setPanelNote("分镜提示词生成完成，请完善提示词与镜头素材。");
            onNote("分镜提示词生成完成。");
          } else if (
            latest.status === "generation_failed" &&
            latest.generationError
          ) {
            setPanelNote(`生成失败：${latest.generationError}`);
            onNote(latest.generationError);
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

  useEffect(() => {
    if (!storyboard) return;
    if (seededBoardId === storyboard.id) return;
    setSeededBoardId(storyboard.id);
    // Keep all shots collapsed on first paint — expanding one card pulls
    // video-history and mounts heavy editors; users expand on demand.
    setExpanded({});
    setFocusShotId(null);
  }, [seededBoardId, storyboard]);

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
      setExpanded((prev) => ({ ...prev, [shotId]: true }));
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
    setExpanded((prev) => ({ ...prev, [shotId]: true }));
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

  const saveScript = useCallback(
    async (acknowledgeInvalidate: boolean) => {
      setSavingScript(true);
      setPanelNote("");
      try {
        let updated = await patchWorkingScript(
          projectId,
          production.episodeId,
          scriptText,
          { acknowledgeInvalidate },
        );
        const shouldReconfirm =
          Boolean(production.confirmedScriptText) ||
          Boolean(production.activeStoryboard) ||
          acknowledgeInvalidate;
        if (shouldReconfirm && updated.workingScriptText.trim()) {
          updated = await confirmScript(projectId, production.episodeId);
        }
        onProductionChange(updated);
        onScriptDraftChange?.(null);
        setShowInvalidateDialog(false);
        setScriptModalOpen(false);
        setPanelNote(
          shouldReconfirm
            ? "剧本已保存。现有分镜提示词仍可使用；也可整集或按镜头重新生成。"
            : "剧本已保存。",
        );
        onNote(
          shouldReconfirm
            ? "剧本已更新：建议检查提示词，可单独重生成某一镜头。"
            : "剧本草稿已保存。",
        );
      } catch (error) {
        if (error instanceof ScriptInvalidateRequiredError) {
          setShowInvalidateDialog(true);
          setPanelNote(error.message);
          return;
        }
        const message =
          error instanceof Error ? error.message : "保存失败，请稍后重试";
        setPanelNote(message);
        onNote(message);
      } finally {
        setSavingScript(false);
      }
    },
    [
      onNote,
      onProductionChange,
      onScriptDraftChange,
      production.activeStoryboard,
      production.confirmedScriptText,
      production.episodeId,
      projectId,
      scriptText,
    ],
  );

  const handleConfirmScript = useCallback(async () => {
    if (scriptDirty) {
      setPanelNote("有未保存的修改，请先在「修改剧本」中保存后再确认。");
      return;
    }
    if (!production.workingScriptText.trim()) {
      setPanelNote("剧本为空，无法确认。");
      return;
    }
    setConfirmingScript(true);
    setPanelNote("");
    try {
      const updated = await confirmScript(projectId, production.episodeId);
      onProductionChange(updated);
      setScriptModalOpen(false);
      setPanelNote("剧本已确认，可以生成分镜提示词。");
      onNote("剧本已确认。");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "确认失败，请稍后重试";
      setPanelNote(message);
      onNote(message);
    } finally {
      setConfirmingScript(false);
    }
  }, [
    onNote,
    onProductionChange,
    production.episodeId,
    production.workingScriptText,
    projectId,
    scriptDirty,
  ]);

  const handleGenerate = useCallback(
    async (opts?: { force?: boolean }) => {
      if (storyboard && !production.storyboardStale && !opts?.force) return;
      setGenerating(true);
      setFocusShotId(null);
      setPanelNote(
        "正在调用模型生成整集提示词，通常需要 1–3 分钟，请勿关闭或刷新页面…",
      );
      onNote("正在生成整集分镜提示词…");
      try {
        const updated = await generateStoryboard(
          projectId,
          production.episodeId,
          idempotencyRef.current,
        );
        onProductionChange(updated);
        setSeededBoardId(null);
        setExpanded({});
        setPanelNote("分镜提示词生成完成，请完善提示词与镜头素材。");
        onNote("分镜提示词生成完成。");
      } catch (error) {
        if (error instanceof StoryboardGenerateInProgressError) {
          onProductionChange(error.production);
          setPanelNote(error.message);
          onNote(error.message);
          return;
        }
        const message =
          error instanceof Error ? error.message : "分镜生成失败";
        setPanelNote(message);
        onNote(message);
      } finally {
        setGenerating(false);
      }
    },
    [
      onNote,
      onProductionChange,
      production.episodeId,
      production.storyboardStale,
      projectId,
      storyboard,
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
      creditEstimate: estimateStoryboardVideoCredits(
        flat
          .slice(0, pending)
          .reduce((s, r) => s + r.shot.durationSeconds, 0) || totalDuration,
      ),
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
      batchKeyRef.current = crypto.randomUUID();
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
    production.status === "storyboard_generating" || generating;
  useGenerationBusy(
    isGenerating,
    `storyboard-prompt-${projectId}-${production.episodeId}`,
    "分镜提示词生成",
  );
  useGenerationBusy(
    batchBusy,
    `storyboard-video-batch-${projectId}-${production.episodeId}`,
    "整集视频生成提交",
  );
  const canGeneratePrompts = scriptConfirmed && !storyboard;
  const canRegenerateEpisodePrompts = scriptConfirmed && Boolean(storyboard);

  const episodeVideoDisabledReason = !storyboard
    ? "请先生成分镜提示词"
    : !canGenerateVideo
      ? "当前账号无视频生成权限"
      : flat.length === 0 ||
          !flat.every((r) => getShotVideoPrompt(r.shot).length > 0)
        ? "请先完善全部镜头提示词"
        : "暂不可生成";

  return (
    <div className="sbw-panel">
      <div className="sbw-panel__head sbw-panel__head--row">
        <div>
          <h2>分镜创作</h2>
          <p className="sbw-hint" style={{ margin: "6px 0 0" }}>
            第 {production.episodeNumber} 集
            {shotCount > 0 ? ` · ${shotCount} 个分镜` : ""}
            {scriptConfirmed ? " · 剧本已确认" : " · 待确认剧本"}
            {confirmed ? " · 分镜已确认" : ""}
          </p>
        </div>
        <div className="sbw-panel__head-actions">
          <button
            type="button"
            className="sbw-btn"
            data-testid="view-script-btn"
            disabled={savingScript || confirmingScript}
            onClick={() => {
              setScriptText(production.workingScriptText);
              onScriptDraftChange?.(null);
              setScriptModalOpen(true);
            }}
          >
            修改剧本
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            data-testid="confirm-script-btn"
            disabled={
              confirmingScript ||
              savingScript ||
              scriptModalOpen ||
              scriptDirty ||
              !production.workingScriptText.trim() ||
              (scriptConfirmed && !production.storyboardStale)
            }
            onClick={() => void handleConfirmScript()}
          >
            {confirmingScript
              ? "确认中…"
              : scriptConfirmed
                ? "剧本已确认"
                : "确认剧本"}
          </button>
        </div>
      </div>

      <div className="sbw-panel__body">
        {production.storyboardStale ? (
          <div className="sbw-banner" data-testid="script-changed-reminder">
            剧本已变更，现有分镜提示词可能不再完全适用。可继续使用当前提示词，也可点击「重新生成本集分镜提示词」。
          </div>
        ) : null}

        {production.status === "generation_failed" &&
        production.generationError ? (
          <div className="sbw-banner is-error">
            生成失败：{production.generationError}
          </div>
        ) : null}

        <div className="sbw-actions sbw-actions--wrap sbw-actions--episode-toolbar">
          {canGeneratePrompts ? (
            <button
              type="button"
              className="sbw-btn sbw-btn-primary"
              data-testid="generate-storyboard-prompts"
              disabled={isGenerating}
              onClick={() => {
                idempotencyRef.current = crypto.randomUUID();
                void handleGenerate();
              }}
            >
              {isGenerating ? "生成中（约 1–3 分钟）…" : "生成分镜提示词"}
            </button>
          ) : null}
          <button
            type="button"
            className="sbw-btn"
            disabled={!storyboard}
            onClick={() =>
              setExpanded(
                Object.fromEntries(flat.map((r) => [r.shot.id, false])),
              )
            }
          >
            全部收起
          </button>
          <EpisodeVideoGenerationButton
            enabled={episodeVideoEnabled}
            disabledReason={episodeVideoDisabledReason}
            busy={batchBusy}
            onClick={handleRequestBatchGenerate}
          />
        </div>

        {isGenerating && !storyboard ? (
          <p className="sbw-note" data-testid="storyboard-generating-hint">
            整集提示词由模型一次性生成，通常需要 1–3 分钟。请勿关闭或刷新页面。
          </p>
        ) : null}

        {incompleteCount > 0 && storyboard ? (
          <p className="sbw-note">
            当前还有 {incompleteCount} 个镜头需要补充提示词或素材。
          </p>
        ) : null}

        {!storyboard ? (
          <div className="sbw-script-stage">
            {displayScript.trim() ? (
              <>
                <pre
                  className="sbw-pre"
                  data-testid="storyboard-script-preview"
                >
                  {displayScript}
                </pre>
                <p className="sbw-hint" style={{ marginTop: 12 }}>
                  {scriptConfirmed
                    ? "剧本已确认，点击「生成分镜提示词」继续。人物、道具、场景可在每个镜头中单独添加。"
                    : "请先点击右上角「确认剧本」，确认后再生成分镜提示词。也可点「修改剧本」编辑正文。"}
                </p>
              </>
            ) : (
              <div className="sbw-empty">
                暂无剧本内容。请点击「修改剧本」粘贴本集正文，保存后确认。
              </div>
            )}
          </div>
        ) : (
          <>
            {canRegenerateEpisodePrompts ? (
              <div className="sbw-shot-list__toolbar">
                <button
                  type="button"
                  className="sbw-btn sbw-btn-primary"
                  data-testid="regenerate-episode-storyboard-prompts"
                  disabled={isGenerating}
                  onClick={() => {
                    idempotencyRef.current = crypto.randomUUID();
                    void handleGenerate({ force: true });
                  }}
                >
                  {isGenerating
                    ? "生成中（约 1–3 分钟）…"
                    : "重新生成本集分镜提示词"}
                </button>
              </div>
            ) : null}
            {isGenerating ? (
              <p className="sbw-note" data-testid="storyboard-generating-hint">
                整集提示词由模型一次性生成，镜头较多时可能需要几分钟。若页面曾刷新，将自动同步结果。
              </p>
            ) : null}
            <div className="sbw-shot-list">
            {flat.map((row) => (
              <StoryboardShotAccordion
                key={row.shot.id}
                projectId={projectId}
                episodeId={production.episodeId}
                storyboardRevision={storyboard.revision}
                episodeConfirmed={confirmed}
                canGenerateVideo={canGenerateVideo}
                shot={row.shot}
                expanded={expanded[row.shot.id] === true}
                onToggle={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [row.shot.id]: !prev[row.shot.id],
                  }))
                }
                assets={assets}
                onProductionChange={onProductionChange}
                highlightUnresolved={focusShotId === row.shot.id}
                openScenePickerToken={scenePickerTokens[row.shot.id] ?? 0}
                videoConfig={videoConfig}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(row.shot.id, el);
                  else cardRefs.current.delete(row.shot.id);
                }}
              />
            ))}
            </div>
          </>
        )}

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

      {scriptModalOpen
        ? createPortal(
            <div
              className="sbw-dialog"
              role="dialog"
              aria-modal="true"
              data-testid="view-script-modal"
            >
              <div className="sbw-dialog__card sbw-dialog__card--script">
                <h3>修改剧本</h3>
                <p className="sbw-hint" style={{ marginTop: 0 }}>
                  第 {production.episodeNumber} 集 · 可直接编辑正文
                </p>
                <textarea
                  className="sbw-textarea sbw-textarea--script-modal"
                  value={scriptText}
                  data-testid="storyboard-script-editor"
                  onChange={(e) => {
                    setScriptText(e.target.value);
                    onScriptDraftChange?.(e.target.value);
                  }}
                  placeholder="请输入或粘贴本集剧本内容…"
                />
                <div className="sbw-dialog__footer">
                  <button
                    type="button"
                    className="sbw-btn"
                    disabled={savingScript}
                    onClick={() => {
                      setScriptText(production.workingScriptText);
                      onScriptDraftChange?.(null);
                      setScriptModalOpen(false);
                      setShowInvalidateDialog(false);
                    }}
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    className={`sbw-btn${scriptDirty ? " sbw-btn-primary" : ""}`}
                    data-testid="view-script-save"
                    disabled={!scriptDirty || savingScript || !scriptText.trim()}
                    onClick={() => void saveScript(false)}
                  >
                    {savingScript ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {showInvalidateDialog
        ? createPortal(
            <div className="sbw-dialog" role="dialog" aria-modal="true">
              <div className="sbw-dialog__card">
                <h3>确认保存剧本变更</h3>
                <p>
                  修改本集剧本后，现有分镜提示词可能不再完全适用。保存后仍可继续使用当前分镜，也可整集或按镜头重新生成提示词。
                </p>
                <div className="sbw-actions">
                  <button
                    type="button"
                    className="sbw-btn"
                    disabled={savingScript}
                    onClick={() => setShowInvalidateDialog(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="sbw-btn sbw-btn-primary"
                    disabled={savingScript}
                    onClick={() => void saveScript(true)}
                  >
                    确认保存
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
