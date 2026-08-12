"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGenerationStatus,
  fetchShotVideoHistory,
  generateShotVideo,
  patchStoryboardShot,
} from "@/projects/storyboard/api-client";
import {
  ProjectAssetPickerDialog,
  type PickerAsset,
} from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { ShotAssetGallery } from "@/projects/storyboard/components/ShotAssetGallery";
import { ShotPromptEditor } from "@/projects/storyboard/components/ShotPromptEditor";
import { ShotSceneRequiredDialog } from "@/projects/storyboard/components/ShotSceneRequiredDialog";
import { ShotVideoGenerationButton } from "@/projects/storyboard/components/ShotVideoGenerationButton";
import { ShotVideoOutputParams } from "@/projects/storyboard/components/ShotVideoOutputParams";
import { ShotVideoPreview } from "@/projects/storyboard/components/ShotVideoPreview";
import {
  VideoGenerationConfirmationDialog,
  type VideoGenerationConfirmPayload,
} from "@/projects/storyboard/components/VideoGenerationConfirmationDialog";
import type { ShotVideoHistoryItem } from "@/projects/storyboard/shot-video-history";
import {
  getShotSceneReadiness,
  getShotVideoBlocker,
} from "@/projects/storyboard/shot-video-precheck";
import {
  resolveLatestShotVideoGeneration,
  type ShotGenerationSnapshot,
} from "@/projects/storyboard/resolve-shot-video";
import { mapGenerationToUiStatus } from "@/projects/storyboard/shot-video-status";
import type { ShotVideoUiStatus } from "@/projects/storyboard/shot-video-status";
import { safeRandomUUID } from "@/lib/safe-random-id";
import {
  SHOT_STATUS_LABEL,
  type EpisodeProduction,
  type ShotAssetRequirement,
  type StoryboardShot,
} from "@/projects/storyboard/types";
import {
  consolidateShotSceneRequirements,
  ensureShotRequirements,
  getShotCompletenessStatus,
  getShotSceneAssetId,
  getShotVideoPrompt,
  linkRequirementToAsset,
  listUnresolvedRequirementIds,
  markRequirementNotRequired,
  restoreRequirementUnresolved,
  unlinkRequirementAsset,
} from "@/projects/storyboard/shot-completeness";
import { findBestAssetIdForRequirementName, autoLinkShotFromPickerAssets } from "@/projects/storyboard/services/shot-library-match";
import { applyShotPromptAssetMount } from "@/projects/storyboard/services/shot-prompt-mount";
import { estimateStoryboardVideoCredits } from "@/projects/storyboard/storyboard-video-constants";
import {
  defaultStoryboardVideoOutputParams,
  type StoryboardVideoDefaults,
  type StoryboardVideoOutputParams,
} from "@/projects/storyboard/storyboard-video-params";
import { labelForStoryboardVideoModelChoice } from "@/projects/storyboard/storyboard-video-model-choices";
import type { GenerationJobStatus } from "@/video-generation/types";
import { formatVideoProviderErrorForUser } from "@/video-generation/user-facing-error";

type Props = {
  projectId: string;
  episodeId: string;
  storyboardRevision: number;
  episodeConfirmed: boolean;
  canGenerateVideo: boolean;
  shot: StoryboardShot;
  expanded: boolean;
  onToggle: () => void;
  assets: PickerAsset[];
  onProductionChange: (production: EpisodeProduction) => void;
  cardRef?: (el: HTMLElement | null) => void;
  highlightUnresolved?: boolean;
  /** 外部请求打开场景选择器（批量预检「去处理」） */
  openScenePickerToken?: number;
  videoConfig?: {
    providerId: string;
    allowPaidGeneration: boolean;
    t2vModelId: string;
    r2vModelId: string;
    usesSd2RealPersonCertification?: boolean;
  } | null;
  /** 项目级视频默认；初始化本镜头控件，不写回全局 */
  videoDefaults?: StoryboardVideoDefaults | null;
};

type PickerTarget = {
  kind: "character" | "prop" | "scene";
};

function toSnapshot(
  gen: {
    id: string;
    status: string;
    progress?: number | null;
    errorMessage?: string | null;
    completedAt?: string | null;
    localVideoAssetId?: string | null;
    actualDurationSeconds?: number | null;
    actualResolution?: string | null;
    providerModelId?: string | null;
    isMock?: boolean;
    updatedAt?: string | null;
  },
): ShotGenerationSnapshot {
  return {
    id: gen.id,
    status: gen.status as GenerationJobStatus,
    progress: gen.progress ?? null,
    errorMessage: gen.errorMessage ?? null,
    completedAt: gen.completedAt ?? null,
    localVideoAssetId: gen.localVideoAssetId ?? null,
    actualDurationSeconds: gen.actualDurationSeconds ?? null,
    actualResolution: gen.actualResolution ?? null,
    providerModelId: gen.providerModelId ?? null,
    isMock: Boolean(gen.isMock),
    updatedAt: gen.updatedAt ?? null,
  };
}

function isTerminalGenerationStatus(status: string | null | undefined): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknownOutcome" ||
    status === "resultTransferFailed"
  );
}

const GENERATION_POLL_MS = 4_000;

export function StoryboardShotAccordion({
  projectId,
  episodeId,
  storyboardRevision,
  episodeConfirmed: _episodeConfirmed,
  canGenerateVideo,
  shot,
  expanded,
  onToggle,
  assets,
  onProductionChange,
  cardRef,
  highlightUnresolved = false,
  openScenePickerToken = 0,
  videoConfig,
  videoDefaults = null,
}: Props) {
  void _episodeConfirmed;
  const serverPrompt = getShotVideoPrompt(shot);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState(shot.revision);
  if (draftRevision !== shot.revision) {
    setDraftRevision(shot.revision);
    setDraftPrompt(null);
  }
  const prompt = draftPrompt ?? serverPrompt;
  const savedPrompt = serverPrompt;
  const [saving, setSaving] = useState(false);
  const [promptSaveFailed, setPromptSaveFailed] = useState(false);
  const [note, setNoteState] = useState("");
  const [noteIsError, setNoteIsError] = useState(false);
  const setNote = useCallback((message: string, isError = false) => {
    setNoteState(message);
    setNoteIsError(isError);
  }, []);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [matchingAssets, setMatchingAssets] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoOutputParams, setVideoOutputParams] =
    useState<StoryboardVideoOutputParams>(() =>
      defaultStoryboardVideoOutputParams(shot.durationSeconds, videoDefaults),
    );
  const videoDefaultsKey = JSON.stringify(videoDefaults ?? null);
  const [syncedVideoDefaultsKey, setSyncedVideoDefaultsKey] =
    useState(videoDefaultsKey);
  if (syncedVideoDefaultsKey !== videoDefaultsKey) {
    setSyncedVideoDefaultsKey(videoDefaultsKey);
    setVideoOutputParams((prev) => ({
      ...defaultStoryboardVideoOutputParams(shot.durationSeconds, videoDefaults),
      durationSeconds: prev.durationSeconds,
    }));
  }
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [shotConfirmVariant, setShotConfirmVariant] = useState<
    "confirm-prompt" | "regen-while-generating"
  >("confirm-prompt");
  const [pendingSlots, setPendingSlots] = useState<
    Array<{
      id: string;
      generationId: string | null;
      status: ShotVideoUiStatus;
      progress: number | null;
      errorMessage: string | null;
    }>
  >([]);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false);
  const [generationSnap, setGenerationSnap] =
    useState<ShotGenerationSnapshot | null>(null);
  const [successSnaps, setSuccessSnaps] = useState<ShotGenerationSnapshot[]>(
    [],
  );
  const [historyVideos, setHistoryVideos] = useState<ShotVideoHistoryItem[]>(
    [],
  );
  const videoKeyRef = useRef<string>(safeRandomUUID());
  const sceneSectionRef = useRef<HTMLDivElement | null>(null);
  const lastSceneTokenRef = useRef(0);

  const status = getShotCompletenessStatus(shot, {
    promptGenerating: false,
    promptSaveFailed,
  });
  const locked = shot.promptLocked || shot.locked;
  const requirements = useMemo(() => ensureShotRequirements(shot), [shot]);
  const unresolvedIds = useMemo(
    () => new Set(listUnresolvedRequirementIds(shot)),
    [shot],
  );

  const assetById = useMemo(() => {
    const map = new Map<string, PickerAsset>();
    for (const a of assets) map.set(a.id, a);
    return map;
  }, [assets]);

  const validSceneIds = useMemo(
    () => new Set(assets.filter((a) => a.kind === "scene").map((a) => a.id)),
    [assets],
  );

  const characterReqs = requirements.filter((r) => r.type === "character");
  const propReqs = requirements.filter((r) => r.type === "prop");
  const sceneReqs = requirements.filter((r) => r.type === "scene");
  const sceneAssetId = getShotSceneAssetId(shot);
  const sceneReadiness = getShotSceneReadiness(shot, validSceneIds);

  const characterAssets = useMemo(
    () =>
      shot.characterAssetIds
        .map((id) => assetById.get(id))
        .filter((a): a is PickerAsset => Boolean(a)),
    [assetById, shot.characterAssetIds],
  );
  const charactersMissingVoice = useMemo(
    () =>
      characterAssets
        .filter((a) => a.kind === "character" && a.voiceBound !== true)
        .map((a) => a.name),
    [characterAssets],
  );
  const charactersSkippedForRealPerson = useMemo(
    () =>
      characterAssets
        .filter((a) => a.videoRefSafetyStatus === "likely_real_person")
        .map((a) => a.name),
    [characterAssets],
  );
  const propAssets = useMemo(
    () =>
      shot.propAssetIds
        .map((id) => assetById.get(id))
        .filter((a): a is PickerAsset => Boolean(a)),
    [assetById, shot.propAssetIds],
  );
  const sceneAssets = useMemo(() => {
    if (!sceneAssetId) return [] as PickerAsset[];
    const asset = assetById.get(sceneAssetId);
    return asset ? [asset] : [];
  }, [assetById, sceneAssetId]);

  const mentionAssets = useMemo(() => {
    const seen = new Set<string>();
    const list: PickerAsset[] = [];
    const push = (asset: PickerAsset | undefined) => {
      if (!asset || seen.has(asset.id)) return;
      seen.add(asset.id);
      list.push(asset);
    };
    for (const a of characterAssets) push(a);
    for (const a of sceneAssets) push(a);
    for (const a of propAssets) push(a);
    // 需求已绑但尚未写入 characterAssetIds 等数组时，仍可 @ 挂载
    for (const req of requirements) {
      if (!req.selectedAssetId) continue;
      push(assetById.get(req.selectedAssetId));
    }
    return list;
  }, [assetById, characterAssets, propAssets, requirements, sceneAssets]);

  const promptImageUrlById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of mentionAssets) {
      const mediaId = shot.assetMediaIds?.[a.id];
      const url =
        (mediaId &&
          a.mediaOptions?.find((m) => m.mediaId === mediaId)?.thumbUrl) ||
        a.thumbUrl;
      if (url) map.set(a.id, url);
    }
    return map;
  }, [mentionAssets, shot.assetMediaIds]);


  const savePatch = useCallback(
    async (patch: Parameters<typeof patchStoryboardShot>[3]) => {
      setSaving(true);
      setNote("");
      try {
        const updated = await patchStoryboardShot(
          projectId,
          episodeId,
          shot.id,
          { ...patch, revision: shot.revision },
        );
        onProductionChange(updated);
        setNote("已保存。");
        setDraftPrompt(null);
        if (typeof patch.videoPrompt === "string") {
          setPromptSaveFailed(false);
        }
        return updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存失败";
        setNote(message, true);
        if (typeof patch.videoPrompt === "string") {
          setPromptSaveFailed(true);
        }
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [episodeId, onProductionChange, projectId, setNote, shot.id, shot.revision],
  );

  const persistShotShape = useCallback(
    async (next: StoryboardShot) => {
      await savePatch({
        requirements: next.requirements,
        characterAssetIds: next.characterAssetIds,
        propAssetIds: next.propAssetIds,
        sceneAssetId: next.sceneAssetId,
        assetMediaIds: next.assetMediaIds ?? {},
      });
    },
    [savePatch],
  );

  const mergeAssetMediaIds = useCallback(
    (
      base: StoryboardShot,
      mediaByAssetId: Record<string, string>,
      keepAssetIds: string[],
    ): Record<string, string> | undefined => {
      const keep = new Set(keepAssetIds);
      const next: Record<string, string> = {
        ...(base.assetMediaIds ?? {}),
        ...mediaByAssetId,
      };
      for (const key of Object.keys(next)) {
        if (!keep.has(key)) delete next[key];
      }
      return Object.keys(next).length > 0 ? next : undefined;
    },
    [],
  );

  const handleSelectAssetMedia = useCallback(
    (assetId: string, mediaId: string) => {
      const next: StoryboardShot = {
        ...shot,
        assetMediaIds: {
          ...(shot.assetMediaIds ?? {}),
          [assetId]: mediaId,
        },
      };
      void persistShotShape(next);
    },
    [persistShotShape, shot],
  );

  const handleSaveAllFields = useCallback(async () => {
    if (prompt === savedPrompt) return;
    await savePatch({ videoPrompt: prompt });
  }, [prompt, savedPrompt, savePatch]);

  useEffect(() => {
    const onSaveAll = () => {
      void handleSaveAllFields();
    };
    window.addEventListener("sbw-save-all-shots", onSaveAll);
    return () => window.removeEventListener("sbw-save-all-shots", onSaveAll);
  }, [handleSaveAllFields]);

  /** 展开时合并重复场景需求（每镜头最多自动合并一次，避免 persist 环） */
  const consolidatedShotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!expanded || locked || saving) return;
    if (consolidatedShotRef.current === shot.id) return;
    const consolidated = consolidateShotSceneRequirements(shot);
    if (consolidated === shot) {
      consolidatedShotRef.current = shot.id;
      return;
    }
    consolidatedShotRef.current = shot.id;
    const timer = window.setTimeout(() => {
      void persistShotShape(consolidated).then(() => {
        setNote("已合并重复的场景需求。");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    expanded,
    locked,
    saving,
    persistShotShape,
    setNote,
    shot,
  ]);

  const openScenePicker = useCallback(() => {
    setSceneDialogOpen(false);
    setVideoDialogOpen(false);
    setVideoBusy(false);
    setPicker({ kind: "scene" });
    requestAnimationFrame(() => {
      sceneSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, []);

  useEffect(() => {
    if (
      openScenePickerToken > 0 &&
      openScenePickerToken !== lastSceneTokenRef.current
    ) {
      lastSceneTokenRef.current = openScenePickerToken;
      openScenePicker();
    }
  }, [openScenePicker, openScenePickerToken]);

  const terminalGenIdsRef = useRef<Set<string>>(new Set());
  const historyFetchedKeyRef = useRef<string | null>(null);
  const historyRequestSeqRef = useRef(0);
  const setNoteRef = useRef(setNote);
  useEffect(() => {
    setNoteRef.current = setNote;
  }, [setNote]);

  const applyGenerationSnapshot = useCallback(
    (gen: Awaited<ReturnType<typeof fetchGenerationStatus>>) => {
      const snap = toSnapshot({
        id: gen.id,
        status: gen.status,
        progress: gen.progress,
        errorMessage: gen.errorMessage,
        completedAt: gen.completedAt,
        localVideoAssetId: gen.localVideoAssetId,
        actualDurationSeconds: gen.actualDurationSeconds,
        actualResolution: gen.actualResolution,
        providerModelId: gen.providerModelId,
        isMock: gen.isMock,
        updatedAt: gen.completedAt,
      });
      setGenerationSnap(snap);
      if (isTerminalGenerationStatus(gen.status)) {
        terminalGenIdsRef.current.add(gen.id);
      }
      if (snap.status === "failed") {
        setNoteRef.current(
          formatVideoProviderErrorForUser(snap.errorMessage),
          true,
        );
      }
      if (snap.status === "completed" && snap.localVideoAssetId) {
        setSuccessSnaps((prev) =>
          [snap, ...prev.filter((s) => s.id !== snap.id)].slice(0, 8),
        );
      }
      return snap;
    },
    [],
  );

  const refreshVideoHistory = useCallback(
    async (force = false) => {
      const key = `${projectId}|${episodeId}|${shot.id}|${shot.videoHistoryGenerationIds.join("|")}|${shot.lastGenerationId ?? ""}`;
      if (!force && historyFetchedKeyRef.current === key) return;
      const requestSeq = ++historyRequestSeqRef.current;
      try {
        const history = await fetchShotVideoHistory(
          projectId,
          episodeId,
          shot.id,
        );
        if (requestSeq !== historyRequestSeqRef.current) return;
        setHistoryVideos(history.videos);
        historyFetchedKeyRef.current = key;
      } catch {
        // Keep the last successful history visible. A transient navigation or
        // session failure must not make persisted videos disappear.
      }
    },
    [
      episodeId,
      projectId,
      shot.id,
      shot.lastGenerationId,
      shot.videoHistoryGenerationIds,
    ],
  );

  const [trackedGenId, setTrackedGenId] = useState(shot.lastGenerationId);
  if (shot.lastGenerationId !== trackedGenId) {
    setTrackedGenId(shot.lastGenerationId);
    setGenerationSnap(null);
  }

  // 仅展开时拉历史；同 key 不重复请求
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshVideoHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, refreshVideoHistory]);

  // Poll parallel pending preview slots (including re-generations while in flight).
  const pendingPollKey = pendingSlots
    .filter(
      (slot) =>
        Boolean(slot.generationId) &&
        (slot.status === "queued" ||
          slot.status === "submitting" ||
          slot.status === "processing"),
    )
    .map((slot) => slot.generationId)
    .sort()
    .join("|");

  const pendingIdSet = useMemo(
    () => new Set(pendingPollKey.split("|").filter(Boolean)),
    [pendingPollKey],
  );

  // 主镜头 generation：仅在途中轮询；终态立刻停；已被 pending 槽覆盖则跳过，避免双拉
  useEffect(() => {
    const generationId = shot.lastGenerationId;
    if (!generationId) return;
    if (terminalGenIdsRef.current.has(generationId)) return;
    if (pendingIdSet.has(generationId)) return;

    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled || timer) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void tick();
      }, GENERATION_POLL_MS);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      if (terminalGenIdsRef.current.has(generationId)) return;
      inFlight = true;
      try {
        const gen = await fetchGenerationStatus(generationId);
        if (cancelled) return;
        applyGenerationSnapshot(gen);
        if (!isTerminalGenerationStatus(gen.status)) {
          // Collapsed cards: one status check is enough; keep polling only when open
          // or when this shot already has parallel pending slots.
          if (expanded || pendingIdSet.size > 0) schedule();
          return;
        }
        if (gen.status === "completed" && expanded) {
          await refreshVideoHistory(true);
        }
      } catch {
        if (!cancelled) schedule();
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    applyGenerationSnapshot,
    expanded,
    pendingIdSet,
    refreshVideoHistory,
    shot.lastGenerationId,
  ]);

  useEffect(() => {
    if (!pendingPollKey) return;
    const ids = pendingPollKey.split("|").filter(Boolean);
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled || timer) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void tick();
      }, GENERATION_POLL_MS);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      inFlight = true;
      let anyActive = false;
      let needHistory = false;
      try {
        for (const generationId of ids) {
          if (cancelled) break;
          if (terminalGenIdsRef.current.has(generationId)) continue;
          try {
            const gen = await fetchGenerationStatus(generationId);
            const ui = mapGenerationToUiStatus(
              gen.status as GenerationJobStatus,
              false,
            );
            const stillActive =
              ui === "queued" || ui === "submitting" || ui === "processing";
            if (stillActive) anyActive = true;

            setPendingSlots((prev) => {
              const next = prev.map((row) =>
                row.generationId === generationId
                  ? {
                      ...row,
                      status: ui,
                      progress: gen.progress ?? null,
                      errorMessage: gen.errorMessage ?? null,
                    }
                  : row,
              );
              return next.filter((row) => {
                if (row.generationId !== generationId) {
                  return (
                    row.status === "queued" ||
                    row.status === "submitting" ||
                    row.status === "processing" ||
                    row.generationId === null
                  );
                }
                return stillActive;
              });
            });

            applyGenerationSnapshot(gen);
            if (ui === "completed") needHistory = true;
          } catch {
            /* ignore single slot poll errors */
            anyActive = true;
          }
        }
        if (needHistory && expanded) {
          await refreshVideoHistory(true);
        }
        if (!cancelled && anyActive) {
          schedule();
        }
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    applyGenerationSnapshot,
    expanded,
    pendingPollKey,
    refreshVideoHistory,
  ]);

  const resolvedVideo = useMemo(
    () =>
      resolveLatestShotVideoGeneration({
        shotId: shot.id,
        storyboardRevision,
        contentStale: shot.videoContentStale,
        generation: generationSnap,
        generations: successSnaps,
        projectId,
      }),
    [
      generationSnap,
      projectId,
      shot.id,
      shot.videoContentStale,
      storyboardRevision,
      successSnaps,
    ],
  );

  const uiVideoStatus = resolvedVideo.uiStatus;
  const hasPendingInFlight = pendingSlots.some(
    (slot) =>
      slot.status === "queued" ||
      slot.status === "submitting" ||
      slot.status === "processing",
  );
  const videoInFlight =
    hasPendingInFlight ||
    uiVideoStatus === "queued" ||
    uiVideoStatus === "submitting" ||
    uiVideoStatus === "processing";

  /** 可点击打开确认弹窗；生成中仍可再次点击（二次确认） */
  const shotVideoClickable =
    canGenerateVideo &&
    Boolean(savedPrompt.trim()) &&
    !saving &&
    !videoBusy;

  const shotConfirmPayload: VideoGenerationConfirmPayload | null = useMemo(() => {
    if (!videoDialogOpen) return null;
    return {
      mode: "shot",
      shotConfirmVariant,
      episodeLabel: episodeId,
      shotLabel: `镜头 ${String(shot.shotNumber).padStart(2, "0")}`,
      videoPrompt: savedPrompt,
      shotCount: 1,
      pendingCount: 1,
      succeededCount: uiVideoStatus === "completed" ? 1 : 0,
      totalDurationSeconds: videoOutputParams.durationSeconds,
      aspectRatio: videoOutputParams.aspectRatio,
      resolution: videoOutputParams.resolution,
      modelLabel: labelForStoryboardVideoModelChoice(
        videoOutputParams.modelChoice,
      ),
      creditEstimate: estimateStoryboardVideoCredits(
        videoOutputParams.durationSeconds,
        videoOutputParams.resolution,
      ),
      isPaidProvider: videoConfig?.providerId === "aliyun-wan27",
      isMockProvider: videoConfig?.providerId === "mock",
      characterAssets: characterAssets.map((a) => a.name),
      propAssets: propAssets.map((a) => a.name),
      sceneAssets: sceneAssets.map((a) => a.name),
      sceneNotRequired: sceneReadiness.ok && sceneReadiness.mode === "not_required",
      charactersMissingVoice,
      charactersSkippedForRealPerson,
      usesSd2RealPersonCertification: Boolean(
        videoConfig?.usesSd2RealPersonCertification,
      ),
    };
  }, [
    characterAssets,
    charactersMissingVoice,
    charactersSkippedForRealPerson,
    episodeId,
    propAssets,
    savedPrompt,
    sceneAssets,
    sceneReadiness,
    shot.shotNumber,
    shotConfirmVariant,
    uiVideoStatus,
    videoConfig,
    videoDialogOpen,
    videoOutputParams.aspectRatio,
    videoOutputParams.durationSeconds,
    videoOutputParams.resolution,
    videoOutputParams.modelChoice,
  ]);

  const resetVideoUiState = useCallback(() => {
    setVideoBusy(false);
    setVideoDialogOpen(false);
    setSceneDialogOpen(false);
  }, []);

  /** 预检必须在 busy / 幂等键占用 / 付费确认之前 */
  const handleRequestGenerate = useCallback(() => {
    setNote("");
    const blocker = getShotVideoBlocker(shot, validSceneIds);
    if (blocker?.code === "SHOT_SCENE_REQUIRED" || blocker?.code === "SHOT_SCENE_INVALID") {
      setVideoDialogOpen(false);
      setVideoBusy(false);
      setSceneDialogOpen(true);
      return;
    }
    if (blocker) {
      setNote(blocker.message);
      setVideoBusy(false);
      setVideoDialogOpen(false);
      return;
    }
    setSceneDialogOpen(false);
    setShotConfirmVariant(
      videoInFlight || hasPendingInFlight
        ? "regen-while-generating"
        : "confirm-prompt",
    );
    setVideoDialogOpen(true);
  }, [hasPendingInFlight, shot, validSceneIds, videoInFlight]);

  const handleShotGenerate = useCallback(async () => {
    // 二次本地预检：防止确认弹窗打开期间状态变化
    const blocker = getShotVideoBlocker(shot, validSceneIds);
    if (blocker) {
      setVideoDialogOpen(false);
      setVideoBusy(false);
      if (
        blocker.code === "SHOT_SCENE_REQUIRED" ||
        blocker.code === "SHOT_SCENE_INVALID"
      ) {
        setSceneDialogOpen(true);
      } else {
        setNote(blocker.message);
      }
      return;
    }

    const clientKey = safeRandomUUID();
    setPendingSlots((prev) => [
      {
        id: clientKey,
        generationId: null,
        status: "submitting",
        progress: null,
        errorMessage: null,
      },
      ...prev,
    ]);
    setVideoBusy(true);
    setNote("");
    setVideoDialogOpen(false);
    try {
      const result = await generateShotVideo(projectId, episodeId, shot.id, {
        storyboardRevision,
        shotRevision: shot.revision,
        idempotencyKey: videoKeyRef.current,
        confirmPaidGeneration: videoConfig?.providerId === "aliyun-wan27",
        resolution: videoOutputParams.resolution,
        aspectRatio: videoOutputParams.aspectRatio,
        durationSeconds: videoOutputParams.durationSeconds,
        videoModelChoice: videoOutputParams.modelChoice,
        stylePreset: videoOutputParams.stylePreset,
      });
      onProductionChange(result.production);
      const snap = toSnapshot({
        id: result.generation.id,
        status: result.generation.status,
        progress: result.generation.progress,
        errorMessage: result.generation.errorMessage,
        completedAt: result.generation.completedAt,
        localVideoAssetId: result.generation.localVideoAssetId,
        actualDurationSeconds: result.generation.actualDurationSeconds,
        actualResolution: result.generation.actualResolution,
        providerModelId: result.generation.providerModelId,
        isMock: result.generation.isMock,
      });
      setGenerationSnap(snap);
      setPendingSlots((prev) =>
        prev.map((slot) =>
          slot.id === clientKey
            ? {
                ...slot,
                generationId: snap.id,
                status: mapGenerationToUiStatus(snap.status, false),
                progress: snap.progress,
                errorMessage: snap.errorMessage,
              }
            : slot,
        ),
      );
      if (snap.status === "failed") {
        setNote(
          formatVideoProviderErrorForUser(
            snap.errorMessage || "视频生成失败",
          ),
          true,
        );
      } else if (result.notice) {
        setNote(result.notice);
      } else {
        setNote("本镜头视频已提交生成。");
      }
    } catch (error) {
      const err = error as Error & { code?: string };
      const message = formatVideoProviderErrorForUser(
        err.message || "视频生成失败",
      );
      setPendingSlots((prev) => prev.filter((slot) => slot.id !== clientKey));
      if (
        err.code === "SHOT_SCENE_REQUIRED" ||
        err.code === "SHOT_SCENE_INVALID"
      ) {
        setSceneDialogOpen(true);
      } else {
        setNote(message, true);
      }
    } finally {
      // 无论成功失败都换新幂等键，避免改提示词/模型后重试被拒
      videoKeyRef.current = safeRandomUUID();
      setVideoBusy(false);
    }
  }, [
    episodeId,
    onProductionChange,
    projectId,
    setNote,
    shot,
    storyboardRevision,
    validSceneIds,
    videoConfig,
    videoOutputParams.aspectRatio,
    videoOutputParams.durationSeconds,
    videoOutputParams.resolution,
    videoOutputParams.modelChoice,
    videoOutputParams.stylePreset,
  ]);

  const handleSavePrompt = useCallback(async () => {
    await savePatch({ videoPrompt: prompt });
  }, [prompt, savePatch]);

  const handleRestorePrompt = useCallback(() => {
    setDraftPrompt(null);
    setPromptSaveFailed(false);
  }, []);

  const handleReplacePromptAssets = useCallback(() => {
    if (locked) {
      setNote("请先解除提示词锁定");
      return;
    }
    const mountAssets = [
      ...characterAssets.map((a) => ({
        id: a.id,
        kind: "character" as const,
        name: a.name,
        imageUrl: promptImageUrlById.get(a.id) ?? a.thumbUrl,
      })),
      ...sceneAssets.map((a) => ({
        id: a.id,
        kind: "scene" as const,
        name: a.name,
        imageUrl: promptImageUrlById.get(a.id) ?? a.thumbUrl,
      })),
      ...propAssets.map((a) => ({
        id: a.id,
        kind: "prop" as const,
        name: a.name,
        imageUrl: promptImageUrlById.get(a.id) ?? a.thumbUrl,
      })),
    ];
    if (mountAssets.length === 0) {
      setNote("请先匹配或添加人物/场景/道具素材，再一键替换。");
      return;
    }
    const withImages = mountAssets.filter((a) => a.imageUrl);
    if (withImages.length === 0) {
      setNote("已绑素材尚无参考图，请先在资产库生成或上传图片后再替换。");
      return;
    }
    const result = applyShotPromptAssetMount(prompt, mountAssets);
    if (!result.changed) {
      setNote("提示词挂载与图片替换已是最新，无需再次替换。");
      return;
    }
    setDraftPrompt(result.prompt);
    const parts = ["已将挂载行与正文中的素材换成参考图"];
    if (
      result.mountLine?.includes("【图:") ||
      result.mountLine?.includes("@场景-")
    ) {
      parts.push("场景已挂载");
    }
    if (result.replacedNames.length > 0) {
      parts.push(`正文替换 ${result.replacedNames.length} 处`);
    }
    setNote(`${parts.join("；")}。请确认后点击保存。`);
  }, [
    characterAssets,
    locked,
    prompt,
    promptImageUrlById,
    propAssets,
    sceneAssets,
  ]);

  const handleLockPrompt = useCallback(async () => {
    if (!prompt.trim()) {
      setNote("请先填写并保存视频提示词。");
      return;
    }
    if (prompt !== savedPrompt) {
      await savePatch({ videoPrompt: prompt, promptLocked: true });
    } else {
      await savePatch({ promptLocked: true });
    }
  }, [prompt, savedPrompt, savePatch]);

  const handleMarkNotRequired = useCallback(
    async (req: ShotAssetRequirement) => {
      if (req.selectedAssetId || req.resolution === "LINKED") {
        const ok = window.confirm(
          "该需求已经绑定资产，继续后将移除本镜头中的对应绑定。",
        );
        if (!ok) return;
      }
      const next = markRequirementNotRequired(shot, req.requirementId);
      await persistShotShape(next);
    },
    [persistShotShape, shot],
  );

  const handleRestoreRequired = useCallback(
    async (req: ShotAssetRequirement) => {
      const next = restoreRequirementUnresolved(shot, req.requirementId);
      await persistShotShape(next);
    },
    [persistShotShape, shot],
  );

  const handleUnlink = useCallback(
    async (req: ShotAssetRequirement) => {
      const next = unlinkRequirementAsset(shot, req.requirementId);
      await persistShotShape(next);
    },
    [persistShotShape, shot],
  );

  const handleMatchAssets = useCallback(async () => {
    if (locked || saving || matchingAssets) return;
    setMatchingAssets(true);
    setNote("");
    try {
      const before = JSON.stringify({
        characters: shot.characterAssetIds,
        props: shot.propAssetIds,
        scene: getShotSceneAssetId(shot),
        requirements: ensureShotRequirements(shot).map((r) => ({
          id: r.requirementId,
          resolution: r.resolution,
          selectedAssetId: r.selectedAssetId,
        })),
      });
      const next = autoLinkShotFromPickerAssets(shot, assets);
      const after = JSON.stringify({
        characters: next.characterAssetIds,
        props: next.propAssetIds,
        scene: getShotSceneAssetId(next),
        requirements: ensureShotRequirements(next).map((r) => ({
          id: r.requirementId,
          resolution: r.resolution,
          selectedAssetId: r.selectedAssetId,
        })),
      });
      if (before === after) {
        setNote("未找到可匹配的资产库项目，请手动添加或检查资产名称。");
        return;
      }
      await persistShotShape(next);
      setNote("已按资产库自动匹配本镜头素材。");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "匹配资产失败");
    } finally {
      setMatchingAssets(false);
    }
  }, [
    assets,
    locked,
    matchingAssets,
    persistShotShape,
    saving,
    shot,
  ]);

  const handlePickerConfirm = useCallback(
    async (ids: string[], selectedMediaByAssetId: Record<string, string> = {}) => {
      const target = picker;
      setPicker(null);
      if (!target) return;

      const mediaByAssetId = Object.fromEntries(
        Object.entries(selectedMediaByAssetId).filter(([assetId, mediaId]) =>
          assetById
            .get(assetId)
            ?.mediaOptions?.some((option) => option.mediaId === mediaId),
        ),
      );

      if (target.kind === "character") {
        const characterAssetIds = [...new Set(ids)];
        let nextShot: StoryboardShot = {
          ...shot,
          characterAssetIds,
          assetMediaIds: mergeAssetMediaIds(shot, mediaByAssetId, [
            ...characterAssetIds,
            ...shot.propAssetIds,
            ...(shot.sceneAssetId ? [shot.sceneAssetId] : []),
          ]),
        };
        for (const req of characterReqs) {
          if (req.resolution === "NOT_REQUIRED") continue;
          const match = findBestAssetIdForRequirementName(
            req.sourceName,
            "character",
            ids
              .map((id) => assetById.get(id))
              .filter((a): a is NonNullable<typeof a> => Boolean(a)),
          );
          if (match && ids.includes(match)) {
            nextShot = linkRequirementToAsset(
              nextShot,
              req.requirementId,
              match,
            );
          } else if (req.selectedAssetId && !ids.includes(req.selectedAssetId)) {
            nextShot = unlinkRequirementAsset(nextShot, req.requirementId);
          }
        }
        await persistShotShape(nextShot);
        return;
      }

      if (target.kind === "prop") {
        const propAssetIds = [...new Set(ids)];
        let nextShot: StoryboardShot = {
          ...shot,
          propAssetIds,
          assetMediaIds: mergeAssetMediaIds(shot, mediaByAssetId, [
            ...shot.characterAssetIds,
            ...propAssetIds,
            ...(shot.sceneAssetId ? [shot.sceneAssetId] : []),
          ]),
        };
        for (const req of propReqs) {
          if (req.resolution === "NOT_REQUIRED") continue;
          const match = findBestAssetIdForRequirementName(
            req.sourceName,
            "prop",
            ids
              .map((id) => assetById.get(id))
              .filter((a): a is NonNullable<typeof a> => Boolean(a)),
          );
          if (match && ids.includes(match)) {
            nextShot = linkRequirementToAsset(
              nextShot,
              req.requirementId,
              match,
            );
          } else if (req.selectedAssetId && !ids.includes(req.selectedAssetId)) {
            nextShot = unlinkRequirementAsset(nextShot, req.requirementId);
          }
        }
        await persistShotShape(nextShot);
        return;
      }

      const nextId = ids[0] ?? null;
      if (sceneAssetId && nextId && nextId !== sceneAssetId) {
        const ok = window.confirm(
          "更换主要场景将替换当前场景绑定，是否继续？",
        );
        if (!ok) return;
      }
      let nextShot: StoryboardShot = {
        ...shot,
        sceneAssetId: nextId,
        sceneAssetIds: nextId ? [nextId] : [],
        assetMediaIds: mergeAssetMediaIds(shot, mediaByAssetId, [
          ...shot.characterAssetIds,
          ...shot.propAssetIds,
          ...(nextId ? [nextId] : []),
        ]),
      };
      if (sceneReqs[0] && nextId) {
        nextShot = linkRequirementToAsset(
          nextShot,
          sceneReqs[0].requirementId,
          nextId,
        );
      } else if (sceneReqs[0] && !nextId) {
        nextShot = unlinkRequirementAsset(nextShot, sceneReqs[0].requirementId);
      } else if (!sceneReqs[0] && !nextId) {
        nextShot = {
          ...nextShot,
          sceneAssetId: null,
          sceneAssetIds: [],
        };
      }
      await persistShotShape(nextShot);
    },
    [
      assetById,
      characterReqs,
      mergeAssetMediaIds,
      persistShotShape,
      picker,
      propReqs,
      sceneAssetId,
      sceneReqs,
      shot,
    ],
  );

  const renderRequirementRow = (req: ShotAssetRequirement) => {
    const linked = req.selectedAssetId
      ? assetById.get(req.selectedAssetId)
      : null;
    const showHint =
      highlightUnresolved && unresolvedIds.has(req.requirementId);

    return (
      <div
        key={req.requirementId}
        className={`sbw-req-row${showHint ? " is-unresolved" : ""}`}
        data-requirement-id={req.requirementId}
      >
        <div className="sbw-req-row__main">
          <span className="sbw-req-row__name">剧本需求：{req.sourceName}</span>
          {req.resolution === "NOT_REQUIRED" ? (
            <span className="sbw-hint">已标记为无需独立资产</span>
          ) : linked ? (
            <span>已添加资产：{linked.name}</span>
          ) : (
            <span className="sbw-hint">尚未添加</span>
          )}
        </div>
        {showHint ? (
          <p className="sbw-req-row__alert">
            请为此需求添加资产，或标记为无需独立资产
          </p>
        ) : null}
        <div className="sbw-req-row__actions">
          {req.resolution === "NOT_REQUIRED" ? (
            <button
              type="button"
              className="sbw-link"
              disabled={saving}
              onClick={() => void handleRestoreRequired(req)}
            >
              恢复为待添加
            </button>
          ) : (
            <>
              {linked ? (
                <button
                  type="button"
                  className="sbw-link"
                  disabled={saving || locked}
                  onClick={() => void handleUnlink(req)}
                >
                  移除绑定
                </button>
              ) : null}
              <button
                type="button"
                className="sbw-link"
                disabled={saving || locked}
                onClick={() => void handleMarkNotRequired(req)}
              >
                此镜头无需独立资产
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const shotLabel = `镜头 ${String(shot.shotNumber).padStart(2, "0")}`;

  return (
    <article
      className={`sbw-shot-card${expanded ? " is-expanded" : ""}${
        highlightUnresolved ? " is-focus-incomplete" : ""
      }`}
      ref={cardRef}
      data-shot-id={shot.id}
    >
      <button type="button" className="sbw-shot-card__summary" onClick={onToggle}>
        <div className="sbw-shot-card__title-row">
          <strong>{shotLabel}</strong>
          <span>
            {shot.durationSeconds.toFixed(1)} 秒 · {shot.shotSize} ·{" "}
            {shot.cameraMovement}
          </span>
          <span className="sbw-badge">{SHOT_STATUS_LABEL[status]}</span>
          <span className="sbw-shot-card__chevron">
            {expanded ? "收起" : "展开"}
          </span>
        </div>
      </button>

      {expanded ? (
        <div className="sbw-shot-card__body">
          <ShotVideoPreview
            status={uiVideoStatus}
            progress={resolvedVideo.generation?.progress ?? null}
            errorMessage={resolvedVideo.generation?.errorMessage ?? null}
            generation={
              resolvedVideo.playbackGeneration ?? resolvedVideo.generation
            }
            contentStale={resolvedVideo.contentStale}
            projectId={projectId}
            historyVideos={historyVideos}
            successGenerations={successSnaps}
            pendingSlots={pendingSlots.map((slot) => ({
              id: slot.id,
              status: slot.status,
              progress: slot.progress,
              errorMessage: slot.errorMessage,
            }))}
          />

          <section className="sbw-shot-section">
            <h4>视频提示词</h4>
            <ShotPromptEditor
              value={prompt}
              disabled={locked || saving}
              imageUrlById={promptImageUrlById}
              mentionAssets={mentionAssets}
              onChange={setDraftPrompt}
            />
            <div className="sbw-actions sbw-actions--prompt">
              <div className="sbw-actions__left">
                <button
                  type="button"
                  className="sbw-btn sbw-btn-primary"
                  disabled={
                    saving || locked || prompt === savedPrompt
                  }
                  onClick={() => void handleSavePrompt()}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="sbw-btn"
                  disabled={
                    saving || locked || prompt === savedPrompt
                  }
                  onClick={handleRestorePrompt}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="sbw-btn"
                  data-testid="replace-prompt-assets"
                  disabled={
                    saving ||
                    locked ||
                    (characterAssets.length === 0 &&
                      propAssets.length === 0 &&
                      sceneAssets.length === 0)
                  }
                  title={
                    locked
                      ? "请先解除提示词锁定"
                      : characterAssets.length === 0 &&
                          propAssets.length === 0 &&
                          sceneAssets.length === 0
                        ? "请先匹配或添加素材"
                        : "将人名/资产名换成参考图，并同步挂载行（含场景）"
                  }
                  onClick={handleReplacePromptAssets}
                >
                  一键替换素材
                </button>
                <button
                  type="button"
                  className="sbw-btn"
                  disabled={saving || locked}
                  onClick={() => void handleLockPrompt()}
                >
                  锁定
                </button>
                {locked ? (
                  <button
                    type="button"
                    className="sbw-btn"
                    disabled={saving}
                    onClick={() =>
                      void savePatch({
                        unlock: true,
                        promptLocked: false,
                        locked: false,
                      })
                    }
                  >
                    解锁
                  </button>
                ) : null}
              </div>
              <ShotVideoGenerationButton
                enabled={shotVideoClickable}
                hasSucceeded={
                  uiVideoStatus === "completed" && !shot.videoContentStale
                }
                contentStale={uiVideoStatus === "stale" || shot.videoContentStale}
                failed={uiVideoStatus === "failed"}
                disabledReason={
                  !canGenerateVideo
                    ? "当前账号无视频生成权限"
                    : !savedPrompt.trim()
                      ? "请先填写视频提示词"
                      : videoBusy
                        ? "正在提交生成任务"
                        : "暂不可生成"
                }
                busy={videoBusy}
                onClick={handleRequestGenerate}
                paramsSlot={
                  <ShotVideoOutputParams
                    value={videoOutputParams}
                    onChange={setVideoOutputParams}
                    disabled={videoBusy}
                  />
                }
              />
            </div>
            {locked ? (
              <p className="sbw-hint">请先解除提示词锁定</p>
            ) : null}
          </section>

          <section className="sbw-shot-section">
            <div className="sbw-shot-section__head">
              <h4>镜头素材</h4>
              <button
                type="button"
                className="sbw-btn"
                data-testid="match-shot-assets"
                disabled={
                  saving || locked || matchingAssets || assets.length === 0
                }
                title={
                  locked
                    ? "请先解除提示词锁定"
                    : assets.length === 0
                      ? "项目资产库为空"
                      : "按名称自动匹配资产库中的人物、道具、场景"
                }
                onClick={() => void handleMatchAssets()}
              >
                {matchingAssets ? "匹配中…" : "匹配资产"}
              </button>
            </div>
            <ShotAssetGallery
              kind="character"
              title="人物"
              assets={characterAssets}
              mediaByAssetId={shot.assetMediaIds}
              disabled={saving || locked || matchingAssets}
              onAdd={() => setPicker({ kind: "character" })}
              onSelectMedia={handleSelectAssetMedia}
              onRemove={(id) => {
                const nextIds = shot.characterAssetIds.filter((x) => x !== id);
                const assetMediaIds = { ...(shot.assetMediaIds ?? {}) };
                delete assetMediaIds[id];
                let next: StoryboardShot = {
                  ...shot,
                  characterAssetIds: nextIds,
                  assetMediaIds:
                    Object.keys(assetMediaIds).length > 0
                      ? assetMediaIds
                      : undefined,
                };
                for (const req of characterReqs) {
                  if (req.selectedAssetId === id) {
                    next = unlinkRequirementAsset(next, req.requirementId);
                  }
                }
                void persistShotShape(next);
              }}
            >
              {characterReqs.length === 0 ? (
                <p className="sbw-hint">无剧本人物需求</p>
              ) : (
                characterReqs.map(renderRequirementRow)
              )}
            </ShotAssetGallery>

            <ShotAssetGallery
              kind="prop"
              title="道具"
              assets={propAssets}
              mediaByAssetId={shot.assetMediaIds}
              disabled={saving || locked || matchingAssets}
              onAdd={() => setPicker({ kind: "prop" })}
              onSelectMedia={handleSelectAssetMedia}
              onRemove={(id) => {
                const nextIds = shot.propAssetIds.filter((x) => x !== id);
                const assetMediaIds = { ...(shot.assetMediaIds ?? {}) };
                delete assetMediaIds[id];
                let next: StoryboardShot = {
                  ...shot,
                  propAssetIds: nextIds,
                  assetMediaIds:
                    Object.keys(assetMediaIds).length > 0
                      ? assetMediaIds
                      : undefined,
                };
                for (const req of propReqs) {
                  if (req.selectedAssetId === id) {
                    next = unlinkRequirementAsset(next, req.requirementId);
                  }
                }
                void persistShotShape(next);
              }}
            >
              {propReqs.length === 0 ? (
                <p className="sbw-hint">无剧本道具需求</p>
              ) : (
                propReqs.map(renderRequirementRow)
              )}
            </ShotAssetGallery>

            <div
              data-scene-assets
              ref={(el) => {
                sceneSectionRef.current = el;
              }}
            >
              <ShotAssetGallery
                kind="scene"
                title="场景"
                assets={sceneAssets}
                mediaByAssetId={shot.assetMediaIds}
                disabled={saving || locked || matchingAssets}
                onAdd={() => setPicker({ kind: "scene" })}
                onSelectMedia={handleSelectAssetMedia}
                onRemove={() => {
                  const assetMediaIds = { ...(shot.assetMediaIds ?? {}) };
                  if (shot.sceneAssetId) delete assetMediaIds[shot.sceneAssetId];
                  let next: StoryboardShot = {
                    ...shot,
                    sceneAssetId: null,
                    sceneAssetIds: [],
                    assetMediaIds:
                      Object.keys(assetMediaIds).length > 0
                        ? assetMediaIds
                        : undefined,
                  };
                  for (const req of sceneReqs) {
                    if (req.resolution === "NOT_REQUIRED") continue;
                    next = unlinkRequirementAsset(next, req.requirementId);
                  }
                  void persistShotShape(next);
                }}
              >
                {sceneReqs.length === 0 ? (
                  <p className="sbw-hint">无剧本场景需求</p>
                ) : (
                  sceneReqs.map(renderRequirementRow)
                )}
              </ShotAssetGallery>
            </div>
          </section>

          {note ? (
            <p
              className={`sbw-note${noteIsError ? " is-error" : ""}`}
              data-testid={noteIsError ? "shot-video-error-note" : undefined}
            >
              {note}
            </p>
          ) : null}
        </div>
      ) : null}

      <ProjectAssetPickerDialog
        open={picker !== null}
        title={
          picker?.kind === "character"
            ? "选择人物"
            : picker?.kind === "prop"
              ? "选择道具"
              : "选择场景"
        }
        kind={picker?.kind ?? "character"}
        assets={assets}
        selectedIds={
          picker?.kind === "character"
            ? shot.characterAssetIds
            : picker?.kind === "prop"
              ? shot.propAssetIds
              : sceneAssetId
                ? [sceneAssetId]
                : []
        }
        selectedMediaByAssetId={shot.assetMediaIds ?? {}}
        multi={picker?.kind === "character" || picker?.kind === "prop"}
        onClose={() => setPicker(null)}
        onConfirm={(ids, mediaByAssetId) =>
          void handlePickerConfirm(ids, mediaByAssetId)
        }
      />

      <ShotSceneRequiredDialog
        open={sceneDialogOpen}
        shotLabel={shotLabel}
        mode="shot"
        onCancel={() => {
          setSceneDialogOpen(false);
          setVideoBusy(false);
        }}
        onGoFix={openScenePicker}
      />

      <VideoGenerationConfirmationDialog
        open={videoDialogOpen}
        payload={shotConfirmPayload}
        includeSucceeded={false}
        onIncludeSucceededChange={() => undefined}
        confirming={videoBusy}
        onCancel={() => {
          if (videoBusy) return;
          resetVideoUiState();
        }}
        onConfirm={() => void handleShotGenerate()}
      />
    </article>
  );
}
