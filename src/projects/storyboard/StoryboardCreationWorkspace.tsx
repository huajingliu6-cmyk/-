"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  autoMatchStoryboardAssets,
  fetchEpisodeDownstreamStatus,
  fetchEpisodeProduction,
  fetchStoryboardWorkspace,
  generateStoryboard,
  patchStoryboardWorkspace,
  patchWorkspaceActiveEpisode,
  scanInvalidStoryboardRefsApi,
} from "@/projects/storyboard/api-client";
import { InvalidRefsRepairDialog } from "@/projects/storyboard/components/InvalidRefsRepairDialog";
import type { InvalidRefScanResult } from "@/projects/storyboard/invalid-refs/types";
import { storyboardNeedsLibraryRematch } from "@/projects/storyboard/services/shot-library-match";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { EpisodeSidebar } from "@/projects/storyboard/components/EpisodeSidebar";
import { StoryboardGlobalSettingsDialog } from "@/projects/storyboard/components/StoryboardGlobalSettingsDialog";
import { StoryboardProductionPanel } from "@/projects/storyboard/components/StoryboardProductionPanel";
import type {
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";
import type { StoryboardVideoDefaults } from "@/projects/storyboard/storyboard-video-params";
import {
  getPromptGenerationServerSnapshot,
  getPromptGenerationSnapshot,
  releaseQueuedPromptGenerationOnPageLeave,
  resolveEpisodePromptGenDisplayStatus,
  STORYBOARD_PROMPT_GEN_MAX_CONCURRENT,
  subscribePromptGeneration,
  syncPromptGenerationFromProduction,
} from "@/projects/storyboard/prompt-generation-manager";
import {
  APP_WORKBENCH_PATH,
  projectManagementPath,
  workspaceProjectAssetsPath,
} from "@/shell/nav";
import { useScriptDownstreamPipeline } from "@/projects/script/use-script-downstream-pipeline";
import type { EpisodeDownstreamStatus } from "@/projects/storyboard/episode-downstream-state";
import { shouldPollEpisodeDownstream } from "@/projects/storyboard/episode-downstream-state";
import { safeRandomUUID } from "@/lib/safe-random-id";
import "@/projects/storyboard/storyboard-workspace.css";

type Props = {
  projectId: string;
  /** management：项目管理分镜；workspace：工作台分镜（链接留在工作台下） */
  context?: "management" | "workspace";
};

function toPickerAssets(summary: AssetsSummary | null): PickerAsset[] {
  if (!summary) return [];
  return [
    ...summary.characters.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "character" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      voiceBound: a.voiceBound === true,
      voiceLabel: a.voiceLabel ?? null,
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
    ...summary.props.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "prop" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
    ...summary.scenes.map((a) => ({
      id: a.id,
      name: a.name,
      kind: "scene" as const,
      thumbUrl: a.thumbUrl,
      ...(a.mediaOptions?.length ? { mediaOptions: a.mediaOptions } : {}),
      videoRefSafetyStatus: a.videoRefSafetyStatus ?? null,
    })),
  ];
}

export function StoryboardCreationWorkspace({
  projectId,
  context = "management",
}: Props) {
  const isWorkspace = context === "workspace";
  const pipelineApiRoot = isWorkspace
    ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
    : `/api/projects/${encodeURIComponent(projectId)}`;
  const pipeline = useScriptDownstreamPipeline(projectId, pipelineApiRoot);
  const promptSnap = useSyncExternalStore(
    subscribePromptGeneration,
    () => getPromptGenerationSnapshot(projectId),
    getPromptGenerationServerSnapshot,
  );

  const [projectName, setProjectName] = useState("");
  const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);
  const [workspace, setWorkspace] = useState<ProjectStoryboardWorkspace | null>(
    null,
  );
  const [assetsSummary, setAssetsSummary] = useState<AssetsSummary | null>(null);
  const [production, setProduction] = useState<EpisodeProduction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [savingGlobalSettings, setSavingGlobalSettings] = useState(false);
  const [invalidRefScan, setInvalidRefScan] =
    useState<InvalidRefScanResult | null>(null);
  const [episodeDownstream, setEpisodeDownstream] =
    useState<EpisodeDownstreamStatus | null>(null);
  const [extractBusy, setExtractBusy] = useState(false);
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [downstreamLoading, setDownstreamLoading] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairFocusShotId, setRepairFocusShotId] = useState<string | null>(
    null,
  );

  const activeEpisodeId = workspace?.activeEpisodeId ?? null;
  const productions = workspace?.productions ?? [];
  const pickerAssets = useMemo(
    () => toPickerAssets(assetsSummary),
    [assetsSummary],
  );

  const promptQueueHint =
    promptSnap.generatingCount > 0 || promptSnap.queuedCount > 0
      ? `（生成中 ${promptSnap.generatingCount}/${STORYBOARD_PROMPT_GEN_MAX_CONCURRENT}，等待 ${promptSnap.queuedCount}）`
      : "";

  const refreshInvalidRefs = useCallback(
    async (episodeId: string | null) => {
      if (!episodeId) {
        setInvalidRefScan(null);
        return;
      }
      try {
        const res = await scanInvalidStoryboardRefsApi(projectId, {
          scope: "episode",
          episodeId,
          context,
          checkBlobs: true,
        });
        setInvalidRefScan(res.scan);
      } catch {
        // Non-blocking: repair entry remains available via manual open.
      }
    },
    [projectId, context],
  );

  const loadProduction = useCallback(
    async (episodeId: string, opts?: { prefer?: EpisodeProduction | null }) => {
      let prod =
        opts?.prefer && opts.prefer.episodeId === episodeId
          ? opts.prefer
          : await fetchEpisodeProduction(projectId, episodeId);

      syncPromptGenerationFromProduction({
        projectId,
        episodeId,
        productionStatus: prod.status,
        generationError: prod.generationError,
        updatedAt: prod.updatedAt,
      });

      if (
        prod.activeStoryboard &&
        prod.status !== "storyboard_generating" &&
        storyboardNeedsLibraryRematch(prod.activeStoryboard)
      ) {
        try {
          if (opts?.prefer && opts.prefer.episodeId === episodeId) {
            prod = await fetchEpisodeProduction(projectId, episodeId);
          }
          if (
            prod.activeStoryboard &&
            prod.status !== "storyboard_generating" &&
            storyboardNeedsLibraryRematch(prod.activeStoryboard)
          ) {
            prod = await autoMatchStoryboardAssets(projectId, episodeId);
          }
        } catch {
          // Non-blocking
        }
      } else if (opts?.prefer && opts.prefer.episodeId === episodeId) {
        try {
          prod = await fetchEpisodeProduction(projectId, episodeId);
        } catch {
          // Keep workspace-cached production if refresh fails.
        }
      }
      setProduction(prod);
      setScriptDraft(null);
      void refreshInvalidRefs(episodeId);
      return prod;
    },
    [projectId, refreshInvalidRefs],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchStoryboardWorkspace(projectId);
      setProjectName(data.project?.name ?? "");
      setEpisodes(data.episodes);
      setWorkspace(data.workspace);
      setAssetsSummary(data.assetsSummary);

      for (const prod of data.workspace?.productions ?? []) {
        syncPromptGenerationFromProduction({
          projectId,
          episodeId: prod.episodeId,
          productionStatus: prod.status,
          generationError: prod.generationError,
          updatedAt: prod.updatedAt,
        });
      }

      const activeId =
        data.workspace?.activeEpisodeId ?? data.episodes[0]?.id ?? null;
      if (activeId) {
        if (data.workspace && data.workspace.activeEpisodeId !== activeId) {
          const saved = await patchWorkspaceActiveEpisode(projectId, activeId);
          setWorkspace(saved);
        }
        const fromWorkspace =
          data.workspace?.productions.find((p) => p.episodeId === activeId) ??
          null;
        if (fromWorkspace) {
          setProduction(fromWorkspace);
        }
        setLoading(false);
        void loadProduction(activeId, { prefer: fromWorkspace });
      } else {
        setProduction(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadProduction, projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadAll();
      } catch {
        if (!cancelled) setError("无法加载分镜工作台");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const handleProductionChange = useCallback((updated: EpisodeProduction) => {
    setProduction((prev) =>
      prev && prev.episodeId === updated.episodeId ? updated : prev,
    );
    setScriptDraft(null);
    setWorkspace((ws) => {
      if (!ws) return ws;
      return {
        ...ws,
        productions: ws.productions.map((p) =>
          p.episodeId === updated.episodeId ? updated : p,
        ),
      };
    });
    syncPromptGenerationFromProduction({
      projectId,
      episodeId: updated.episodeId,
      productionStatus: updated.status,
      generationError: updated.generationError,
      updatedAt: updated.updatedAt,
    });
  }, [projectId]);

  const refreshEpisodeDownstream = useCallback(
    async (episodeId: string) => {
      const status = await fetchEpisodeDownstreamStatus(projectId, episodeId);
      setEpisodeDownstream(status);
      return status;
    },
    [projectId],
  );

  useEffect(() => {
    if (!production?.episodeId) {
      setEpisodeDownstream(null);
      return;
    }
    let cancelled = false;
    setDownstreamLoading(true);
    void fetchEpisodeDownstreamStatus(projectId, production.episodeId)
      .then((status) => {
        if (!cancelled) setEpisodeDownstream(status);
      })
      .catch(() => {
        if (!cancelled) setEpisodeDownstream(null);
      })
      .finally(() => {
        if (!cancelled) setDownstreamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    production?.episodeId,
    production?.status,
    production?.confirmedScriptText,
    production?.activeStoryboard,
  ]);

  useEffect(() => {
    const episodeId = production?.episodeId;
    if (!episodeId) return;
    const pipelineBusy = shouldPollEpisodeDownstream(episodeDownstream, {
      extractingAssets: pipeline.extractingAssets,
      productionStatus: production?.status ?? null,
    });
    if (!pipelineBusy) return;
    const timer = window.setInterval(() => {
      void refreshEpisodeDownstream(episodeId);
      void loadProduction(episodeId);
      void fetchStoryboardWorkspace(projectId).then((data) => {
        setAssetsSummary(data.assetsSummary);
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [
    episodeDownstream,
    loadProduction,
    pipeline.extractingAssets,
    production?.episodeId,
    production?.status,
    projectId,
    refreshEpisodeDownstream,
  ]);

  useEffect(() => {
    return () => {
      releaseQueuedPromptGenerationOnPageLeave(projectId);
    };
  }, [projectId]);

  const handleExtractEpisode = useCallback(
    async (episodeId: string) => {
      setExtractBusy(true);
      setSaveNote("");
      try {
        const res = await fetch(`${pipelineApiRoot}/asset-extraction/tasks`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "episode", episodeId }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(payload.error ?? "无法开始提取本集资产");
        }
        setSaveNote(
          "已开始提取本集资产，完成后将自动入库并生成分镜提示词。",
        );
        await refreshEpisodeDownstream(episodeId);
      } catch (err) {
        setSaveNote(err instanceof Error ? err.message : "提取失败");
      } finally {
        setExtractBusy(false);
      }
    },
    [pipelineApiRoot, refreshEpisodeDownstream],
  );

  const handleRegenerateStoryboard = useCallback(
    async (episodeId: string) => {
      setRegenerateBusy(true);
      setSaveNote("");
      try {
        const updated = await generateStoryboard(
          projectId,
          episodeId,
          safeRandomUUID(),
        );
        handleProductionChange(updated);
        syncPromptGenerationFromProduction({
          projectId,
          episodeId,
          productionStatus: updated.status,
          generationError: updated.generationError,
          updatedAt: updated.updatedAt,
        });
        if (updated.status === "generation_failed") {
          setSaveNote(
            updated.generationError?.trim() ||
              "分镜提示词生成失败，请稍后重试。",
          );
        } else {
          setSaveNote("分镜提示词已重新生成。");
        }
        await refreshEpisodeDownstream(episodeId);
      } catch (err) {
        setSaveNote(
          err instanceof Error ? err.message : "重新生成分镜提示词失败",
        );
        await refreshEpisodeDownstream(episodeId);
        await loadProduction(episodeId);
      } finally {
        setRegenerateBusy(false);
      }
    },
    [handleProductionChange, loadProduction, projectId, refreshEpisodeDownstream],
  );

  const handleSelectEpisode = useCallback(
    async (episodeId: string) => {
      if (episodeId === activeEpisodeId) return;
      setSwitchingEpisode(true);
      setSaveNote("");
      try {
        const saved = await patchWorkspaceActiveEpisode(projectId, episodeId);
        setWorkspace(saved);
        await loadProduction(episodeId);
      } catch (err) {
        setSaveNote(err instanceof Error ? err.message : "切换剧集失败");
      } finally {
        setSwitchingEpisode(false);
      }
    },
    [activeEpisodeId, loadProduction, projectId],
  );

  const handleSaveGlobalSettings = useCallback(
    async (next: StoryboardVideoDefaults) => {
      setSavingGlobalSettings(true);
      setSaveNote("");
      try {
        const saved = await patchStoryboardWorkspace(projectId, {
          videoDefaults: next,
          ...(activeEpisodeId ? { activeEpisodeId } : {}),
        });
        setWorkspace(saved);
        setGlobalSettingsOpen(false);
        setSaveNote("全局设置已保存。");
      } catch (err) {
        setSaveNote(
          err instanceof Error ? err.message : "保存全局设置失败，请稍后重试",
        );
      } finally {
        setSavingGlobalSettings(false);
      }
    },
    [activeEpisodeId, projectId],
  );

  const emptyBackHref = isWorkspace
    ? APP_WORKBENCH_PATH
    : `${projectManagementPath(projectId)}/script`;
  const emptyBackLabel = isWorkspace ? "返回工作台" : "返回剧本处理";
  const assetsHref = isWorkspace
    ? workspaceProjectAssetsPath(projectId)
    : `${projectManagementPath(projectId)}/assets/library`;
  const designHref = isWorkspace
    ? `${workspaceProjectAssetsPath(projectId)}/design`
    : `${projectManagementPath(projectId)}/assets/design`;
  const activeEpisodeMeta = production
    ? episodes.find((episode) => episode.id === production.episodeId) ?? null
    : null;

  const activePromptStatus = production
    ? resolveEpisodePromptGenDisplayStatus({
        productionStatus: production.status,
        hasStoryboard: Boolean(production.activeStoryboard),
        job: promptSnap.jobs[production.episodeId],
      })
    : "idle";

  if (loading) {
    return (
      <div className="sbw" data-testid="storyboard-workspace-skeleton">
        <div className="sbw-inner">
          <div className="sbw-layout">
            <div className="sbw-sidebar sbw-skeleton" aria-hidden />
            <div className="sbw-panel sbw-skeleton" aria-hidden />
          </div>
        </div>
      </div>
    );
  }

  if (error && episodes.length === 0) {
    return (
      <div className="sbw">
        <div className="sbw-inner">
          <div className="sbw-empty">
            <p>{error}</p>
            <Link href={emptyBackHref} className="sbw-link" style={{ marginTop: 12 }}>
              {emptyBackLabel}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="sbw">
        <div className="sbw-inner">
          <header className="sbw-head">
            <div className="sbw-head__titles">
              <h1>尚未创建分集</h1>
              <p>
                {projectName ? `${projectName} · ` : ""}
                请先完成剧本分集
              </p>
            </div>
          </header>
          <div className="sbw-empty">
            <p>请先在剧本工作台完成分集，再进入分镜创作。</p>
            <Link href={emptyBackHref} className="sbw-link" style={{ marginTop: 12 }}>
              {emptyBackLabel}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sbw">
      <div className="sbw-inner">
        {!pipeline.loading && pipeline.extractingAssets ? (
          <p
            className="sbw-pipeline-banner"
            role="status"
            data-testid="storyboard-extracting-banner"
          >
            {pipeline.message || "资产提取中…"}
          </p>
        ) : null}
        {!pipeline.loading &&
        pipeline.phase === "generating_storyboard" &&
        pipeline.message ? (
          <p
            className="sbw-pipeline-banner"
            role="status"
            data-testid="storyboard-pipeline-banner"
          >
            {pipeline.message}
          </p>
        ) : null}
        <div className="sbw-layout">
          <EpisodeSidebar
            episodes={episodes}
            productions={productions}
            activeEpisodeId={activeEpisodeId}
            switching={switchingEpisode}
            promptJobs={promptSnap.jobs}
            onSelect={(id) => void handleSelectEpisode(id)}
          />

          {!production ? (
            <div className="sbw-panel">
              <div className="sbw-empty">请选择剧集</div>
            </div>
          ) : (
            <StoryboardProductionPanel
              key={production.episodeId}
              projectId={projectId}
              production={production}
              assets={pickerAssets}
              episodeDownstream={episodeDownstream}
              episodeNumber={
                activeEpisodeMeta?.episodeNumber ?? production.episodeNumber
              }
              episodeTitle={activeEpisodeMeta?.title ?? null}
              extractBusy={extractBusy}
              regenerateBusy={regenerateBusy}
              extractingAssets={pipeline.extractingAssets}
              onExtractEpisode={() => void handleExtractEpisode(production.episodeId)}
              onRegenerateStoryboard={() =>
                void handleRegenerateStoryboard(production.episodeId)
              }
              assetsHref={assetsHref}
              designHref={designHref}
              onProductionChange={handleProductionChange}
              onAssetsRefresh={async () => {
                const data = await fetchStoryboardWorkspace(projectId);
                setAssetsSummary(data.assetsSummary);
                void refreshInvalidRefs(production.episodeId);
              }}
              onNote={setSaveNote}
              onScriptDraftChange={setScriptDraft}
              videoDefaults={workspace?.videoDefaults}
              promptGenStatus={activePromptStatus}
              promptGenError={
                promptSnap.jobs[production.episodeId]?.error ||
                production.generationError ||
                undefined
              }
              promptQueueHint={promptQueueHint}
              onOpenGlobalSettings={() => setGlobalSettingsOpen(true)}
              pageSaveNote={
                [
                  saveNote,
                  error,
                  promptQueueHint,
                  downstreamLoading ? "正在同步本集阶段状态…" : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              invalidRefScan={invalidRefScan}
              onOpenInvalidRefsRepair={(shotId) => {
                setRepairFocusShotId(shotId ?? null);
                setRepairOpen(true);
              }}
            />
          )}
        </div>

        <InvalidRefsRepairDialog
          open={repairOpen}
          projectId={projectId}
          context={context}
          episodeId={activeEpisodeId}
          assets={pickerAssets}
          focusShotId={repairFocusShotId}
          onClose={() => {
            setRepairOpen(false);
            setRepairFocusShotId(null);
          }}
          onApplied={(rescan) => {
            setInvalidRefScan(rescan);
            void loadProduction(activeEpisodeId ?? production?.episodeId ?? "");
          }}
        />
      </div>

      <StoryboardGlobalSettingsDialog
        open={globalSettingsOpen}
        initial={workspace?.videoDefaults}
        saving={savingGlobalSettings}
        onClose={() => setGlobalSettingsOpen(false)}
        onSave={handleSaveGlobalSettings}
      />
    </div>
  );
}
